"""Rank classification via the multi-scan HOG+SVM+template pipeline.

Ported from ``Rank_MultiScan_HOG_SVM_v2.ipynb``. Every function below is copied
verbatim (algorithm unchanged) from that notebook's cells 8, 10, 12, 18, 20 and
30 — only the training-time code, dataset loading, plotting and cross-validation
were left out. The module-level constants replicate the notebook's cell 4 config
plus the runtime namespace the integration notebook builds. Inference entry
points: ``prepare_unknown_sample(image_path)`` then ``predict_sample(sample, bundle)``.

The trained bundle lives in ``models/rank_multiscan_hog_svm_v2.joblib`` and is
loaded by ``RankClassifier``.
"""

from __future__ import annotations

import math
import os
import shutil
from collections import Counter
from pathlib import Path
from typing import Any

import cv2
import joblib
import numpy as np
from PIL import Image

# ── Config (verbatim from notebook cell 4) ──────────────────────────────────
NUM_CLASSES = 13

CARD_WIDTH = 600
CARD_HEIGHT = 900

MAX_CARD_QUAD_CANDIDATES = 4
QUAD_EXPANSION = 1.045
MAX_RANK_PAIR_CANDIDATES = 5
MAX_COMPONENT_CANDIDATES_PER_SIDE = 4

SCAN_WINDOW_SIZES = [
    (0.18, 0.12), (0.22, 0.14), (0.26, 0.16), (0.30, 0.18),
    (0.34, 0.20), (0.38, 0.22), (0.42, 0.25),
]
SCAN_OFFSETS = [
    (0.000, 0.000), (0.015, 0.010), (0.030, 0.020), (0.045, 0.030),
]
ORIENTATION_ROTATIONS = [0, 90, 180, 270]

HOG_IMAGE_SIZE = 64

SVM_WEIGHT = 0.80
TEMPLATE_WEIGHT = 0.20
TOP_BASE_WEIGHT = 0.65
BOTTOM_BASE_WEIGHT = 0.35
TEMPLATE_TOP_K = 3
TEMPLATE_TEMPERATURE = 0.08

CLASSIFIER_CONFIDENCE_WEIGHT = 0.55
CLASSIFIER_MARGIN_WEIGHT = 0.20
EXTRACTION_SCORE_WEIGHT = 0.25

CONFIDENCE_THRESHOLD = 0.38
MARGIN_THRESHOLD = 0.07
EXTRACTION_ACCEPT_THRESHOLD = 0.30

# Temporary dir for the intermediate candidate crops prepare_unknown_sample writes.
# Per-process (PID) so parallel recognition workers never clobber each other.
_UNKNOWN_CANDIDATE_DIR = Path("/tmp") / f"handhistory_rank_candidates_{os.getpid()}"


def order_quad_points(points):
    points = np.asarray(
        points,
        dtype=np.float32
    )

    point_sum = points.sum(
        axis=1
    )

    point_difference = np.diff(
        points,
        axis=1
    ).reshape(-1)

    return np.array(
        [
            points[
                np.argmin(
                    point_sum
                )
            ],
            points[
                np.argmin(
                    point_difference
                )
            ],
            points[
                np.argmax(
                    point_sum
                )
            ],
            points[
                np.argmax(
                    point_difference
                )
            ]
        ],
        dtype=np.float32
    )

def expand_quad(
    quad,
    image_shape,
    factor=1.045
):
    quad = np.asarray(
        quad,
        dtype=np.float32
    )

    center = quad.mean(
        axis=0,
        keepdims=True
    )

    expanded = (
        center
        + (
            quad
            - center
        ) * factor
    )

    image_height, image_width = (
        image_shape[:2]
    )

    expanded[:, 0] = np.clip(
        expanded[:, 0],
        0,
        image_width - 1
    )

    expanded[:, 1] = np.clip(
        expanded[:, 1],
        0,
        image_height - 1
    )

    return expanded

def approximate_quad(
    contour
):
    hull = cv2.convexHull(
        contour
    )

    perimeter = cv2.arcLength(
        hull,
        True
    )

    for epsilon_ratio in [
        0.008,
        0.012,
        0.016,
        0.020,
        0.025,
        0.030,
        0.040,
        0.050,
        0.070
    ]:
        approximation = (
            cv2.approxPolyDP(
                hull,
                epsilon_ratio
                * perimeter,
                True
            )
        )

        if (
            len(approximation) == 4
            and cv2.isContourConvex(
                approximation
            )
        ):
            return (
                approximation
                .reshape(
                    4,
                    2
                )
            )

    return None

def bounding_iou(
    first_quad,
    second_quad
):
    first_box = cv2.boundingRect(
        np.asarray(
            first_quad,
            dtype=np.int32
        )
    )

    second_box = cv2.boundingRect(
        np.asarray(
            second_quad,
            dtype=np.int32
        )
    )

    x1 = max(
        first_box[0],
        second_box[0]
    )

    y1 = max(
        first_box[1],
        second_box[1]
    )

    x2 = min(
        first_box[0]
        + first_box[2],
        second_box[0]
        + second_box[2]
    )

    y2 = min(
        first_box[1]
        + first_box[3],
        second_box[1]
        + second_box[3]
    )

    intersection = max(
        0,
        x2 - x1
    ) * max(
        0,
        y2 - y1
    )

    first_area = (
        first_box[2]
        * first_box[3]
    )

    second_area = (
        second_box[2]
        * second_box[3]
    )

    union = (
        first_area
        + second_area
        - intersection
    )

    if union <= 0:
        return 0.0

    return float(
        intersection
        / union
    )

def quad_geometry_score(
    quad,
    contour_area,
    image_width,
    image_height
):
    quad = order_quad_points(
        quad
    )

    image_area = (
        image_width
        * image_height
    )

    area_ratio = (
        contour_area
        / image_area
    )

    if not (
        0.02
        <= area_ratio
        <= 0.78
    ):
        return None

    x, y, width, height = (
        cv2.boundingRect(
            quad.astype(
                np.int32
            )
        )
    )

    box_area = max(
        width * height,
        1
    )

    rectangularity = (
        contour_area
        / box_area
    )

    if rectangularity < 0.28:
        return None

    touching_edges = sum(
        [
            x <= 2,
            y <= 2,
            x + width
            >= image_width - 2,
            y + height
            >= image_height - 2
        ]
    )

    if touching_edges >= 2:
        return None

    center = quad.mean(
        axis=0
    )

    normalized_distance = (
        np.linalg.norm(
            (
                center
                - np.array(
                    [
                        image_width / 2.0,
                        image_height / 2.0
                    ]
                )
            )
            / np.array(
                [
                    image_width,
                    image_height
                ]
            )
        )
    )

    center_score = max(
        0.05,
        1.0
        - normalized_distance
    )

    top_left, top_right, bottom_right, bottom_left = (
        quad
    )

    average_width = (
        np.linalg.norm(
            top_right
            - top_left
        )
        + np.linalg.norm(
            bottom_right
            - bottom_left
        )
    ) / 2.0

    average_height = (
        np.linalg.norm(
            bottom_left
            - top_left
        )
        + np.linalg.norm(
            bottom_right
            - top_right
        )
    ) / 2.0

    long_short_ratio = (
        max(
            average_width,
            average_height
        )
        / max(
            min(
                average_width,
                average_height
            ),
            1.0
        )
    )

    aspect_score = float(
        np.exp(
            -(
                (
                    long_short_ratio
                    - 1.50
                ) / 0.90
            ) ** 2
        )
    )

    edge_penalty = (
        0.55
        if touching_edges == 1
        else 1.0
    )

    score = (
        area_ratio
        * (
            0.45
            + rectangularity
        )
        * (
            0.35
            + center_score
        )
        * (
            0.45
            + aspect_score
        )
        * edge_penalty
    )

    return float(
        score
    )

def collect_candidates_from_binary(
    binary,
    image_width,
    image_height,
    source_name,
    score_multiplier=1.0,
    retrieval_mode=cv2.RETR_LIST
):
    contours, _ = cv2.findContours(
        binary,
        retrieval_mode,
        cv2.CHAIN_APPROX_SIMPLE
    )

    candidates = []

    for contour in contours:
        hull = cv2.convexHull(
            contour
        )

        contour_area = cv2.contourArea(
            hull
        )

        if contour_area <= 0:
            continue

        quad = approximate_quad(
            hull
        )

        method = source_name

        if quad is None:
            rectangle = cv2.minAreaRect(
                hull
            )

            box_points = cv2.boxPoints(
                rectangle
            )

            quad = box_points

            method = (
                source_name
                + "_minrect"
            )

        score = quad_geometry_score(
            quad,
            contour_area,
            image_width,
            image_height
        )

        if score is None:
            continue

        candidates.append(
            {
                "quad": (
                    order_quad_points(
                        quad
                    )
                ),
                "score": float(
                    score
                    * score_multiplier
                ),
                "method": method
            }
        )

    return candidates

def detect_card_quad_candidates(
    rgb_image,
    maximum_side=1000
):
    original_height, original_width = (
        rgb_image.shape[:2]
    )

    scale = min(
        1.0,
        maximum_side
        / max(
            original_height,
            original_width
        )
    )

    if scale < 1.0:
        resized = cv2.resize(
            rgb_image,
            (
                max(
                    1,
                    int(
                        original_width
                        * scale
                    )
                ),
                max(
                    1,
                    int(
                        original_height
                        * scale
                    )
                )
            ),
            interpolation=cv2.INTER_AREA
        )
    else:
        resized = rgb_image.copy()

    image_height, image_width = (
        resized.shape[:2]
    )

    gray = cv2.cvtColor(
        resized,
        cv2.COLOR_RGB2GRAY
    )

    clahe = cv2.createCLAHE(
        clipLimit=2.0,
        tileGridSize=(8, 8)
    )

    enhanced = clahe.apply(
        gray
    )

    blurred = cv2.GaussianBlur(
        enhanced,
        (5, 5),
        0
    )

    median_value = float(
        np.median(
            blurred
        )
    )

    lower_threshold = int(
        max(
            10,
            0.45
            * median_value
        )
    )

    upper_threshold = int(
        min(
            255,
            max(
                lower_threshold
                + 20,
                1.35
                * median_value
            )
        )
    )

    edge_maps = [
        (
            cv2.Canny(
                blurred,
                lower_threshold,
                upper_threshold
            ),
            "auto_canny",
            1.00
        ),
        (
            cv2.Canny(
                gray,
                30,
                110
            ),
            "fixed_canny",
            0.96
        )
    ]

    all_candidates = []

    close_kernel = cv2.getStructuringElement(
        cv2.MORPH_RECT,
        (7, 7)
    )

    for (
        edge_map,
        source_name,
        multiplier
    ) in edge_maps:
        processed = cv2.morphologyEx(
            edge_map,
            cv2.MORPH_CLOSE,
            close_kernel,
            iterations=2
        )

        processed = cv2.dilate(
            processed,
            np.ones(
                (3, 3),
                dtype=np.uint8
            ),
            iterations=1
        )

        all_candidates.extend(
            collect_candidates_from_binary(
                processed,
                image_width,
                image_height,
                source_name,
                score_multiplier=(
                    multiplier
                ),
                retrieval_mode=cv2.RETR_LIST
            )
        )

    hsv = cv2.cvtColor(
        resized,
        cv2.COLOR_RGB2HSV
    )

    lab = cv2.cvtColor(
        resized,
        cv2.COLOR_RGB2LAB
    )

    saturation = hsv[:, :, 1]
    value = hsv[:, :, 2]

    lightness = lab[:, :, 0]
    lab_b = lab[:, :, 2]

    masks = [
        (
            (
                (
                    saturation < 110
                )
                & (
                    value > 100
                )
            ).astype(
                np.uint8
            )
            * 255,
            "hsv_card",
            0.90
        ),
        (
            (
                (
                    lab_b
                    < min(
                        158,
                        int(
                            np.percentile(
                                lab_b,
                                45
                            )
                            + 10
                        )
                    )
                )
                & (
                    lightness
                    > np.percentile(
                        lightness,
                        45
                    )
                )
            ).astype(
                np.uint8
            )
            * 255,
            "lab_card",
            0.88
        )
    ]

    mask_close_kernel = cv2.getStructuringElement(
        cv2.MORPH_ELLIPSE,
        (15, 15)
    )

    mask_open_kernel = cv2.getStructuringElement(
        cv2.MORPH_ELLIPSE,
        (5, 5)
    )

    for (
        mask,
        source_name,
        multiplier
    ) in masks:
        processed = cv2.morphologyEx(
            mask,
            cv2.MORPH_CLOSE,
            mask_close_kernel,
            iterations=2
        )

        processed = cv2.morphologyEx(
            processed,
            cv2.MORPH_OPEN,
            mask_open_kernel,
            iterations=1
        )

        all_candidates.extend(
            collect_candidates_from_binary(
                processed,
                image_width,
                image_height,
                source_name,
                score_multiplier=(
                    multiplier
                ),
                retrieval_mode=cv2.RETR_EXTERNAL
            )
        )

    all_candidates.sort(
        key=lambda item:
        item["score"],
        reverse=True
    )

    selected = []

    for candidate in all_candidates:
        is_duplicate = any(
            bounding_iou(
                candidate["quad"],
                selected_candidate[
                    "quad"
                ]
            ) > 0.82
            for selected_candidate
            in selected
        )

        if is_duplicate:
            continue

        selected.append(
            candidate
        )

        if (
            len(selected)
            >= MAX_CARD_QUAD_CANDIDATES
        ):
            break

    for candidate in selected:
        candidate["quad"] = (
            candidate["quad"]
            / scale
        )

    # 四角形候補がない場合だけ中央領域を追加
    if len(selected) == 0:
        x_margin = (
            original_width
            * 0.14
        )

        y_margin = (
            original_height
            * 0.14
        )

        selected.append(
            {
                "quad": np.array(
                    [
                        [
                            x_margin,
                            y_margin
                        ],
                        [
                            original_width
                            - x_margin,
                            y_margin
                        ],
                        [
                            original_width
                            - x_margin,
                            original_height
                            - y_margin
                        ],
                        [
                            x_margin,
                            original_height
                            - y_margin
                        ]
                    ],
                    dtype=np.float32
                ),
                "score": 0.05,
                "method": (
                    "center_fallback"
                )
            }
        )

    maximum_score = max(
        candidate["score"]
        for candidate in selected
    )

    for candidate in selected:
        candidate[
            "normalized_quad_score"
        ] = float(
            candidate["score"]
            / max(
                maximum_score,
                1.0e-8
            )
        )

    return selected

def warp_card_to_front(
    rgb_image,
    quad
):
    expanded_quad = expand_quad(
        quad,
        rgb_image.shape,
        factor=QUAD_EXPANSION
    )

    source_points = order_quad_points(
        expanded_quad
    )

    destination_points = np.array(
        [
            [0, 0],
            [
                CARD_WIDTH - 1,
                0
            ],
            [
                CARD_WIDTH - 1,
                CARD_HEIGHT - 1
            ],
            [
                0,
                CARD_HEIGHT - 1
            ]
        ],
        dtype=np.float32
    )

    perspective_matrix = (
        cv2.getPerspectiveTransform(
            source_points,
            destination_points
        )
    )

    return cv2.warpPerspective(
        rgb_image,
        perspective_matrix,
        (
            CARD_WIDTH,
            CARD_HEIGHT
        ),
        flags=cv2.INTER_LINEAR,
        borderMode=cv2.BORDER_CONSTANT,
        borderValue=(
            255,
            255,
            255
        )
    )

def rotate_card_to_portrait(
    card_rgb,
    rotation
):
    if rotation == 0:
        rotated = card_rgb

    elif rotation == 90:
        rotated = cv2.rotate(
            card_rgb,
            cv2.ROTATE_90_CLOCKWISE
        )

    elif rotation == 180:
        rotated = cv2.rotate(
            card_rgb,
            cv2.ROTATE_180
        )

    elif rotation == 270:
        rotated = cv2.rotate(
            card_rgb,
            cv2.ROTATE_90_COUNTERCLOCKWISE
        )

    else:
        raise ValueError(
            f"未対応の回転角度です: {rotation}"
        )

    return cv2.resize(
        rotated,
        (
            CARD_WIDTH,
            CARD_HEIGHT
        ),
        interpolation=cv2.INTER_LINEAR
    )

def normalize_card_appearance(
    card_rgb
):
    gray = cv2.cvtColor(
        card_rgb,
        cv2.COLOR_RGB2GRAY
    )

    clahe = cv2.createCLAHE(
        clipLimit=1.7,
        tileGridSize=(8, 8)
    )

    enhanced = clahe.apply(
        gray
    )

    normalized = cv2.addWeighted(
        gray,
        0.40,
        enhanced,
        0.60,
        0
    )

    return normalized

HOG_DESCRIPTOR = cv2.HOGDescriptor(
    (
        64,
        64
    ),
    (
        16,
        16
    ),
    (
        8,
        8
    ),
    (
        8,
        8
    ),
    9
)

def remove_small_components(
    binary,
    minimum_area_ratio=0.0007
):
    count, labels_map, stats, _ = (
        cv2.connectedComponentsWithStats(
            binary,
            connectivity=8
        )
    )

    image_area = (
        binary.shape[0]
        * binary.shape[1]
    )

    minimum_area = max(
        8,
        int(
            image_area
            * minimum_area_ratio
        )
    )

    cleaned = np.zeros_like(
        binary
    )

    for component_id in range(
        1,
        count
    ):
        area = stats[
            component_id,
            cv2.CC_STAT_AREA
        ]

        if area >= minimum_area:
            cleaned[
                labels_map
                == component_id
            ] = 255

    return cleaned

def fit_binary_to_canvas(
    binary,
    output_size=64,
    target_size=50
):
    y_points, x_points = np.where(
        binary > 0
    )

    if len(x_points) == 0:
        return np.zeros(
            (
                output_size,
                output_size
            ),
            dtype=np.uint8
        )

    x_min = int(
        x_points.min()
    )

    x_max = int(
        x_points.max()
    )

    y_min = int(
        y_points.min()
    )

    y_max = int(
        y_points.max()
    )

    cropped = binary[
        y_min:
        y_max + 1,
        x_min:
        x_max + 1
    ]

    height, width = (
        cropped.shape
    )

    scale = min(
        target_size / max(
            width,
            1
        ),
        target_size / max(
            height,
            1
        )
    )

    new_width = max(
        1,
        int(
            round(
                width
                * scale
            )
        )
    )

    new_height = max(
        1,
        int(
            round(
                height
                * scale
            )
        )
    )

    resized = cv2.resize(
        cropped,
        (
            new_width,
            new_height
        ),
        interpolation=cv2.INTER_NEAREST
    )

    canvas = np.zeros(
        (
            output_size,
            output_size
        ),
        dtype=np.uint8
    )

    x_offset = (
        output_size
        - new_width
    ) // 2

    y_offset = (
        output_size
        - new_height
    ) // 2

    canvas[
        y_offset:
        y_offset + new_height,
        x_offset:
        x_offset + new_width
    ] = resized

    return canvas

def binary_candidate_quality(
    standardized,
    component_count,
    vertical_position_score
):
    foreground_ratio = float(
        np.mean(
            standardized > 0
        )
    )

    occupancy_score = float(
        np.exp(
            -(
                (
                    foreground_ratio
                    - 0.17
                ) / 0.15
            ) ** 2
        )
    )

    laplacian_variance = float(
        cv2.Laplacian(
            standardized,
            cv2.CV_32F
        ).var()
    )

    sharpness_score = min(
        1.0,
        laplacian_variance
        / 9000.0
    )

    y_points, x_points = np.where(
        standardized > 0
    )

    if len(x_points) == 0:
        centering_score = 0.0
        size_score = 0.0

    else:
        center_x = (
            x_points.mean()
            / standardized.shape[1]
        )

        center_y = (
            y_points.mean()
            / standardized.shape[0]
        )

        centering_score = float(
            np.exp(
                -(
                    (
                        center_x - 0.5
                    ) / 0.28
                ) ** 2
                -(
                    (
                        center_y - 0.5
                    ) / 0.28
                ) ** 2
            )
        )

        width_ratio = (
            x_points.max()
            - x_points.min()
            + 1
        ) / standardized.shape[1]

        height_ratio = (
            y_points.max()
            - y_points.min()
            + 1
        ) / standardized.shape[0]

        size_score = min(
            1.0,
            (
                width_ratio
                + height_ratio
            ) / 1.25
        )

    component_score = (
        1.0
        if component_count
        in [1, 2]
        else max(
            0.25,
            1.0
            - 0.18
            * (
                component_count - 2
            )
        )
    )

    quality = (
        0.28
        * occupancy_score
        + 0.20
        * sharpness_score
        + 0.16
        * centering_score
        + 0.14
        * size_score
        + 0.12
        * component_score
        + 0.10
        * vertical_position_score
    )

    return float(
        np.clip(
            quality,
            0.0,
            1.0
        )
    )

def threshold_variants(
    gray_crop
):
    clahe = cv2.createCLAHE(
        clipLimit=1.8,
        tileGridSize=(6, 6)
    )

    enhanced = clahe.apply(
        gray_crop
    )

    blurred = cv2.GaussianBlur(
        enhanced,
        (3, 3),
        0
    )

    _, otsu = cv2.threshold(
        blurred,
        0,
        255,
        cv2.THRESH_BINARY_INV
        + cv2.THRESH_OTSU
    )

    adaptive = cv2.adaptiveThreshold(
        blurred,
        255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY_INV,
        21,
        7
    )

    return [
        (
            "otsu",
            otsu
        ),
        (
            "adaptive",
            adaptive
        )
    ]

def component_group_candidates(
    binary,
    threshold_name
):
    binary = remove_small_components(
        binary
    )

    crop_height, crop_width = (
        binary.shape
    )

    count, labels_map, stats, _ = (
        cv2.connectedComponentsWithStats(
            binary,
            connectivity=8
        )
    )

    crop_area = (
        crop_height
        * crop_width
    )

    components = []

    for component_id in range(
        1,
        count
    ):
        x, y, width, height, area = (
            stats[
                component_id
            ]
        )

        if area < max(
            8,
            int(
                crop_area
                * 0.0008
            )
        ):
            continue

        if (
            height
            < crop_height
            * 0.07
        ):
            continue

        if (
            width
            < crop_width
            * 0.008
        ):
            continue

        if (
            width
            > crop_width
            * 0.94
            or height
            > crop_height
            * 0.94
        ):
            continue

        touches_border = (
            x <= 1
            or y <= 1
            or x + width
            >= crop_width - 1
            or y + height
            >= crop_height - 1
        )

        if (
            touches_border
            and area
            > crop_area
            * 0.015
        ):
            continue

        components.append(
            {
                "id": component_id,
                "x": x,
                "y": y,
                "width": width,
                "height": height,
                "area": area,
                "center_x": (
                    x + width / 2.0
                ),
                "center_y": (
                    y + height / 2.0
                )
            }
        )

    if len(components) == 0:
        return []

    groups = []

    # 各成分単独
    for component in components:
        groups.append(
            [
                component
            ]
        )

    # 上端・中心高さの近い成分をまとめる
    for anchor in components:
        group = [
            component
            for component in components
            if (
                abs(
                    component["y"]
                    - anchor["y"]
                )
                <= crop_height
                * 0.13
                and abs(
                    component["center_y"]
                    - anchor["center_y"]
                )
                <= crop_height
                * 0.16
            )
        ]

        group = sorted(
            group,
            key=lambda item:
            item["x"]
        )[:4]

        if len(group) >= 2:
            groups.append(
                group
            )

    candidates = []
    seen_signatures = set()

    for group in groups:
        signature = tuple(
            sorted(
                component["id"]
                for component in group
            )
        )

        if signature in seen_signatures:
            continue

        seen_signatures.add(
            signature
        )

        x_min = min(
            component["x"]
            for component in group
        )

        y_min = min(
            component["y"]
            for component in group
        )

        x_max = max(
            component["x"]
            + component["width"]
            for component in group
        )

        y_max = max(
            component["y"]
            + component["height"]
            for component in group
        )

        group_width = max(
            1,
            x_max - x_min
        )

        group_height = max(
            1,
            y_max - y_min
        )

        # ランクは走査窓の上半分に存在しやすい
        normalized_top = (
            y_min
            / crop_height
        )

        vertical_position_score = float(
            np.exp(
                -(
                    normalized_top
                    / 0.46
                ) ** 2
            )
        )

        if normalized_top > 0.72:
            continue

        # 横に離れ過ぎた成分は別物とみなす
        if len(group) >= 2:
            sorted_group = sorted(
                group,
                key=lambda item:
                item["x"]
            )

            gaps = [
                sorted_group[index + 1][
                    "x"
                ]
                - (
                    sorted_group[index][
                        "x"
                    ]
                    + sorted_group[index][
                        "width"
                    ]
                )
                for index in range(
                    len(sorted_group)
                    - 1
                )
            ]

            if max(gaps) > max(
                group_height
                * 0.90,
                crop_width
                * 0.20
            ):
                continue

        mask = np.zeros_like(
            binary
        )

        for component in group:
            mask[
                labels_map
                == component["id"]
            ] = 255

        padding_x = max(
            2,
            int(
                group_width
                * 0.15
            )
        )

        padding_y = max(
            2,
            int(
                group_height
                * 0.15
            )
        )

        x1 = max(
            0,
            x_min - padding_x
        )

        y1 = max(
            0,
            y_min - padding_y
        )

        x2 = min(
            crop_width,
            x_max + padding_x
        )

        y2 = min(
            crop_height,
            y_max + padding_y
        )

        cropped_mask = mask[
            y1:y2,
            x1:x2
        ]

        standardized = (
            fit_binary_to_canvas(
                cropped_mask,
                output_size=64,
                target_size=50
            )
        )

        quality = (
            binary_candidate_quality(
                standardized,
                component_count=(
                    len(group)
                ),
                vertical_position_score=(
                    vertical_position_score
                )
            )
        )

        candidates.append(
            {
                "image": standardized,
                "quality": quality,
                "component_count": (
                    len(group)
                ),
                "threshold": (
                    threshold_name
                ),
                "bbox": (
                    x1,
                    y1,
                    x2,
                    y2
                )
            }
        )

    candidates.sort(
        key=lambda item:
        item["quality"],
        reverse=True
    )

    unique_candidates = []

    for candidate in candidates:
        duplicate = False

        for existing in (
            unique_candidates
        ):
            similarity = (
                normalized_correlation(
                    candidate["image"],
                    existing["image"]
                )
            )

            if similarity > 0.985:
                duplicate = True
                break

        if duplicate:
            continue

        unique_candidates.append(
            candidate
        )

        if (
            len(unique_candidates)
            >= MAX_COMPONENT_CANDIDATES_PER_SIDE
        ):
            break

    return unique_candidates

def generate_rank_candidates(
    gray_crop
):
    # カード外周が入りやすい端を少し除去する
    crop_height, crop_width = (
        gray_crop.shape
    )

    trim_x = max(
        1,
        int(
            crop_width
            * 0.015
        )
    )

    trim_y = max(
        1,
        int(
            crop_height
            * 0.015
        )
    )

    trimmed = gray_crop[
        trim_y:
        crop_height - trim_y,
        trim_x:
        crop_width - trim_x
    ]

    all_candidates = []

    for (
        threshold_name,
        binary
    ) in threshold_variants(
        trimmed
    ):
        all_candidates.extend(
            component_group_candidates(
                binary,
                threshold_name
            )
        )

    all_candidates.sort(
        key=lambda item:
        item["quality"],
        reverse=True
    )

    unique_candidates = []

    for candidate in all_candidates:
        duplicate = any(
            normalized_correlation(
                candidate["image"],
                existing["image"]
            ) > 0.985
            for existing
            in unique_candidates
        )

        if duplicate:
            continue

        unique_candidates.append(
            candidate
        )

        if (
            len(unique_candidates)
            >= MAX_COMPONENT_CANDIDATES_PER_SIDE
        ):
            break

    return unique_candidates

def normalized_correlation(
    first_image,
    second_image
):
    first = (
        first_image
        .reshape(-1)
        .astype(
            np.float32
        )
    )

    second = (
        second_image
        .reshape(-1)
        .astype(
            np.float32
        )
    )

    first = (
        first
        - first.mean()
    )

    second = (
        second
        - second.mean()
    )

    denominator = (
        np.linalg.norm(
            first
        )
        * np.linalg.norm(
            second
        )
    )

    if denominator < 1.0e-8:
        return 0.0

    return float(
        np.dot(
            first,
            second
        )
        / denominator
    )

def hog_cosine_similarity(
    first_image,
    second_image
):
    first_hog = (
        HOG_DESCRIPTOR
        .compute(
            first_image
        )
        .reshape(-1)
        .astype(
            np.float32
        )
    )

    second_hog = (
        HOG_DESCRIPTOR
        .compute(
            second_image
        )
        .reshape(-1)
        .astype(
            np.float32
        )
    )

    denominator = (
        np.linalg.norm(
            first_hog
        )
        * np.linalg.norm(
            second_hog
        )
    )

    if denominator < 1.0e-8:
        return 0.0

    cosine = float(
        np.dot(
            first_hog,
            second_hog
        )
        / denominator
    )

    return (
        cosine + 1.0
    ) / 2.0

def pair_shape_similarity(
    top_image,
    bottom_image
):
    correlation = (
        normalized_correlation(
            top_image,
            bottom_image
        )
    )

    correlation = (
        correlation + 1.0
    ) / 2.0

    hog_similarity = (
        hog_cosine_similarity(
            top_image,
            bottom_image
        )
    )

    return float(
        np.clip(
            0.55
            * correlation
            + 0.45
            * hog_similarity,
            0.0,
            1.0
        )
    )

def crop_symmetric_corners(
    card_gray,
    width_ratio,
    height_ratio,
    x_offset_ratio,
    y_offset_ratio
):
    card_height, card_width = (
        card_gray.shape
    )

    crop_width = max(
        8,
        int(
            card_width
            * width_ratio
        )
    )

    crop_height = max(
        8,
        int(
            card_height
            * height_ratio
        )
    )

    x_offset = int(
        card_width
        * x_offset_ratio
    )

    y_offset = int(
        card_height
        * y_offset_ratio
    )

    top_x1 = np.clip(
        x_offset,
        0,
        card_width - crop_width
    )

    top_y1 = np.clip(
        y_offset,
        0,
        card_height - crop_height
    )

    top_crop = card_gray[
        top_y1:
        top_y1 + crop_height,
        top_x1:
        top_x1 + crop_width
    ]

    bottom_x1 = np.clip(
        card_width
        - x_offset
        - crop_width,
        0,
        card_width - crop_width
    )

    bottom_y1 = np.clip(
        card_height
        - y_offset
        - crop_height,
        0,
        card_height - crop_height
    )

    bottom_crop = card_gray[
        bottom_y1:
        bottom_y1 + crop_height,
        bottom_x1:
        bottom_x1 + crop_width
    ]

    bottom_crop = cv2.rotate(
        bottom_crop,
        cv2.ROTATE_180
    )

    return (
        top_crop,
        bottom_crop
    )

def rank_pair_score(
    top_candidate,
    bottom_candidate,
    quad_score,
    width_ratio,
    height_ratio
):
    similarity = (
        pair_shape_similarity(
            top_candidate["image"],
            bottom_candidate[
                "image"
            ]
        )
    )

    top_quality = (
        top_candidate["quality"]
    )

    bottom_quality = (
        bottom_candidate[
            "quality"
        ]
    )

    # 過度に大きな走査窓は
    # スート・絵柄を含みやすいため少し減点
    compactness = float(
        np.exp(
            -(
                (
                    width_ratio - 0.27
                ) / 0.20
            ) ** 2
            -(
                (
                    height_ratio - 0.17
                ) / 0.14
            ) ** 2
        )
    )

    score = (
        0.46
        * similarity
        + 0.20
        * top_quality
        + 0.20
        * bottom_quality
        + 0.09
        * quad_score
        + 0.05
        * compactness
    )

    return {
        "score": float(
            np.clip(
                score,
                0.0,
                1.0
            )
        ),
        "similarity": (
            similarity
        ),
        "top_quality": (
            top_quality
        ),
        "bottom_quality": (
            bottom_quality
        )
    }

def deduplicate_rank_pairs(
    pair_candidates
):
    pair_candidates.sort(
        key=lambda item:
        item["score"],
        reverse=True
    )

    unique = []

    for candidate in pair_candidates:
        duplicate = False

        for existing in unique:
            top_similarity = (
                normalized_correlation(
                    candidate[
                        "top_image"
                    ],
                    existing[
                        "top_image"
                    ]
                )
            )

            bottom_similarity = (
                normalized_correlation(
                    candidate[
                        "bottom_image"
                    ],
                    existing[
                        "bottom_image"
                    ]
                )
            )

            if (
                top_similarity > 0.985
                and bottom_similarity
                > 0.985
            ):
                duplicate = True
                break

        if duplicate:
            continue

        unique.append(
            candidate
        )

        if (
            len(unique)
            >= MAX_RANK_PAIR_CANDIDATES
        ):
            break

    return unique

def extract_multiscan_rank_pairs(
    image,
    quad_candidates=None
):
    rgb_image = np.array(
        image.convert("RGB")
    )

    if quad_candidates is None:
        quad_candidates = (
            detect_card_quad_candidates(
                rgb_image
            )
        )

    all_pair_candidates = []

    for quad_index, quad_candidate in enumerate(
        quad_candidates
    ):
        warped = warp_card_to_front(
            rgb_image,
            quad_candidate[
                "quad"
            ]
        )

        for rotation in (
            ORIENTATION_ROTATIONS
        ):
            oriented = (
                rotate_card_to_portrait(
                    warped,
                    rotation
                )
            )

            card_gray = (
                normalize_card_appearance(
                    oriented
                )
            )

            for (
                width_ratio,
                height_ratio
            ) in SCAN_WINDOW_SIZES:
                for (
                    x_offset_ratio,
                    y_offset_ratio
                ) in SCAN_OFFSETS:
                    (
                        top_crop,
                        bottom_crop
                    ) = crop_symmetric_corners(
                        card_gray,
                        width_ratio,
                        height_ratio,
                        x_offset_ratio,
                        y_offset_ratio
                    )

                    top_candidates = (
                        generate_rank_candidates(
                            top_crop
                        )
                    )

                    bottom_candidates = (
                        generate_rank_candidates(
                            bottom_crop
                        )
                    )

                    if (
                        len(top_candidates)
                        == 0
                        or len(
                            bottom_candidates
                        )
                        == 0
                    ):
                        continue

                    for top_candidate in (
                        top_candidates
                    ):
                        for bottom_candidate in (
                            bottom_candidates
                        ):
                            score_information = (
                                rank_pair_score(
                                    top_candidate,
                                    bottom_candidate,
                                    quad_candidate[
                                        "normalized_quad_score"
                                    ],
                                    width_ratio,
                                    height_ratio
                                )
                            )

                            all_pair_candidates.append(
                                {
                                    "top_image": (
                                        top_candidate[
                                            "image"
                                        ]
                                    ),
                                    "bottom_image": (
                                        bottom_candidate[
                                            "image"
                                        ]
                                    ),
                                    "score": (
                                        score_information[
                                            "score"
                                        ]
                                    ),
                                    "similarity": (
                                        score_information[
                                            "similarity"
                                        ]
                                    ),
                                    "top_quality": (
                                        score_information[
                                            "top_quality"
                                        ]
                                    ),
                                    "bottom_quality": (
                                        score_information[
                                            "bottom_quality"
                                        ]
                                    ),
                                    "quad": (
                                        quad_candidate[
                                            "quad"
                                        ]
                                    ),
                                    "quad_method": (
                                        quad_candidate[
                                            "method"
                                        ]
                                    ),
                                    "quad_index": (
                                        quad_index
                                    ),
                                    "rotation": (
                                        rotation
                                    ),
                                    "window": {
                                        "width_ratio": (
                                            width_ratio
                                        ),
                                        "height_ratio": (
                                            height_ratio
                                        ),
                                        "x_offset_ratio": (
                                            x_offset_ratio
                                        ),
                                        "y_offset_ratio": (
                                            y_offset_ratio
                                        )
                                    },
                                    "top_threshold": (
                                        top_candidate[
                                            "threshold"
                                        ]
                                    ),
                                    "bottom_threshold": (
                                        bottom_candidate[
                                            "threshold"
                                        ]
                                    )
                                }
                            )

    if len(all_pair_candidates) == 0:
        blank = np.zeros(
            (
                HOG_IMAGE_SIZE,
                HOG_IMAGE_SIZE
            ),
            dtype=np.uint8
        )

        return [
            {
                "top_image": blank,
                "bottom_image": blank,
                "score": 0.0,
                "similarity": 0.0,
                "top_quality": 0.0,
                "bottom_quality": 0.0,
                "quad": (
                    quad_candidates[0][
                        "quad"
                    ]
                ),
                "quad_method": (
                    "rank_scan_failed"
                ),
                "quad_index": 0,
                "rotation": 0,
                "window": {
                    "width_ratio": 0.0,
                    "height_ratio": 0.0,
                    "x_offset_ratio": 0.0,
                    "y_offset_ratio": 0.0
                },
                "top_threshold": "none",
                "bottom_threshold": "none"
            }
        ]

    return deduplicate_rank_pairs(
        all_pair_candidates
    )

def load_binary(path):
    image = Image.open(
        path
    ).convert("L")

    array = np.array(
        image,
        dtype=np.uint8
    )

    _, binary = cv2.threshold(
        array,
        127,
        255,
        cv2.THRESH_BINARY
    )

    return binary

def extract_shape_features(
    image
):
    image = image.astype(
        np.uint8
    )

    hog_feature = (
        HOG_DESCRIPTOR
        .compute(
            image
        )
        .reshape(-1)
        .astype(
            np.float32
        )
    )

    float_image = (
        image.astype(
            np.float32
        )
        / 255.0
    )

    horizontal_projection = (
        float_image.mean(
            axis=1
        )
    )

    vertical_projection = (
        float_image.mean(
            axis=0
        )
    )

    pixel_feature = cv2.resize(
        float_image,
        (
            24,
            24
        ),
        interpolation=cv2.INTER_AREA
    ).reshape(-1)

    moments = cv2.moments(
        image
    )

    hu_moments = (
        cv2.HuMoments(
            moments
        )
        .reshape(-1)
    )

    hu_moments = (
        -np.sign(
            hu_moments
        )
        * np.log10(
            np.abs(
                hu_moments
            )
            + 1.0e-12
        )
    ).astype(
        np.float32
    )

    occupancy = np.array(
        [
            float_image.mean(),
            float_image[
                :32,
                :
            ].mean(),
            float_image[
                32:,
                :
            ].mean(),
            float_image[
                :,
                :32
            ].mean(),
            float_image[
                :,
                32:
            ].mean()
        ],
        dtype=np.float32
    )

    return np.concatenate(
        [
            hog_feature,
            horizontal_projection.astype(
                np.float32
            ),
            vertical_projection.astype(
                np.float32
            ),
            pixel_feature.astype(
                np.float32
            ),
            hu_moments,
            occupancy
        ]
    )

def softmax_numpy(
    values,
    temperature=1.0
):
    values = np.asarray(
        values,
        dtype=np.float64
    )

    shifted = (
        values
        - values.max()
    ) / max(
        float(
            temperature
        ),
        1.0e-6
    )

    exponential = np.exp(
        np.clip(
            shifted,
            -60,
            60
        )
    )

    return (
        exponential
        / exponential.sum()
    )

def template_probabilities(
    image,
    template_bank
):
    query = (
        image.astype(
            np.float32
        ) / 255.0
    )

    class_scores = []

    for class_id in range(
        NUM_CLASSES
    ):
        similarities = [
            normalized_correlation(
                query,
                template
            )
            for template
            in template_bank[
                class_id
            ]
        ]

        if len(similarities) == 0:
            class_scores.append(
                -1.0
            )
            continue

        similarities = sorted(
            similarities,
            reverse=True
        )

        top_values = similarities[
            :min(
                TEMPLATE_TOP_K,
                len(
                    similarities
                )
            )
        ]

        class_scores.append(
            float(
                np.mean(
                    top_values
                )
            )
        )

    return softmax_numpy(
        class_scores,
        temperature=(
            TEMPLATE_TEMPERATURE
        )
    )

def side_probabilities(
    image,
    model_bundle
):
    feature = (
        extract_shape_features(
            image
        ).reshape(
            1,
            -1
        )
    )

    svm_model = model_bundle[
        "svm_model"
    ]

    partial_probability = (
        svm_model.predict_proba(
            feature
        )[0]
    )

    svm_probability = np.zeros(
        NUM_CLASSES,
        dtype=np.float64
    )

    for position, class_id in enumerate(
        svm_model.classes_
    ):
        svm_probability[
            int(class_id)
        ] = partial_probability[
            position
        ]

    template_probability = (
        template_probabilities(
            image,
            model_bundle[
                "template_bank"
            ]
        )
    )

    combined = (
        SVM_WEIGHT
        * svm_probability
        + TEMPLATE_WEIGHT
        * template_probability
    )

    combined = (
        combined
        / combined.sum()
    )

    return combined

def classify_extraction_candidate(
    candidate,
    model_bundle
):
    top_image = load_binary(
        candidate[
            "top_path"
        ]
    )

    bottom_image = load_binary(
        candidate[
            "bottom_path"
        ]
    )

    top_probability = (
        side_probabilities(
            top_image,
            model_bundle
        )
    )

    bottom_probability = (
        side_probabilities(
            bottom_image,
            model_bundle
        )
    )

    top_weight = (
        TOP_BASE_WEIGHT
        * max(
            candidate[
                "top_quality"
            ],
            0.10
        )
    )

    bottom_weight = (
        BOTTOM_BASE_WEIGHT
        * max(
            candidate[
                "bottom_quality"
            ],
            0.10
        )
    )

    weight_sum = max(
        top_weight
        + bottom_weight,
        1.0e-8
    )

    fused_probability = (
        top_weight
        * top_probability
        + bottom_weight
        * bottom_probability
    ) / weight_sum

    order = np.argsort(
        fused_probability
    )[::-1]

    confidence = float(
        fused_probability[
            order[0]
        ]
    )

    margin = float(
        fused_probability[
            order[0]
        ]
        - fused_probability[
            order[1]
        ]
    )

    candidate_selection_score = (
        CLASSIFIER_CONFIDENCE_WEIGHT
        * confidence
        + CLASSIFIER_MARGIN_WEIGHT
        * margin
        + EXTRACTION_SCORE_WEIGHT
        * candidate[
            "score"
        ]
    )

    return {
        "prediction": int(
            order[0]
        ),
        "probability": (
            fused_probability
        ),
        "confidence": (
            confidence
        ),
        "margin": (
            margin
        ),
        "selection_score": float(
            candidate_selection_score
        ),
        "top_prediction": int(
            np.argmax(
                top_probability
            )
        ),
        "bottom_prediction": int(
            np.argmax(
                bottom_probability
            )
        ),
        "top_weight": float(
            top_weight
            / weight_sum
        ),
        "bottom_weight": float(
            bottom_weight
            / weight_sum
        ),
        "candidate": candidate
    }

def predict_sample(
    sample,
    model_bundle
):
    evaluated_candidates = [
        classify_extraction_candidate(
            candidate,
            model_bundle
        )
        for candidate
        in sample[
            "candidates"
        ]
    ]

    evaluated_candidates.sort(
        key=lambda item:
        item[
            "selection_score"
        ],
        reverse=True
    )

    best = (
        evaluated_candidates[0]
    )

    accepted = (
        best[
            "confidence"
        ] >= CONFIDENCE_THRESHOLD
        and best[
            "margin"
        ] >= MARGIN_THRESHOLD
        and best[
            "candidate"
        ][
            "score"
        ] >= EXTRACTION_ACCEPT_THRESHOLD
    )

    best[
        "accepted"
    ] = accepted

    best[
        "all_evaluated_candidates"
    ] = evaluated_candidates

    return best

# ==========================================================
# 分離済みカードの直接入力 (card_recognizer_integrated_v3.ipynb)
#
# splitterが既にカードを切り出しているのに、Rank側でも外周を再検出すると
# カードの内側をさらに小さく切り出してしまい、数字が欠けたり歪んだりする。
# 分離画像は「画面全体がカード」として扱い、外周再検出を行わない。
# ==========================================================

# 分離カードの外周をさらに削る割合。0で無効(v3の既定値)。
SPLIT_CARD_TRIM_RATIO = 0.0

# 直接入力が完全に失敗したときだけ、従来の外周再検出へ戻すか。
ALLOW_RANK_REDETECT_FALLBACK = True


def prepare_split_card_direct_image(image):
    """分離済みカードを、外周再検出なしでRank入力へ整える。"""

    rgb_image = np.array(image.convert("RGB"))
    image_height, image_width = rgb_image.shape[:2]

    # splitterが横向きで保存した場合だけ縦向きへ揃える。
    # 上下の向きは後段の0・90・180・270度走査で決定する。
    if image_width > image_height:
        rgb_image = cv2.rotate(rgb_image, cv2.ROTATE_90_CLOCKWISE)
        image_height, image_width = rgb_image.shape[:2]

    trim_ratio = float(np.clip(SPLIT_CARD_TRIM_RATIO, 0.0, 0.10))
    trim_x = int(image_width * trim_ratio)
    trim_y = int(image_height * trim_ratio)

    if trim_x > 0 or trim_y > 0:
        x1, y1 = trim_x, trim_y
        x2, y2 = image_width - trim_x, image_height - trim_y
        if x2 - x1 >= 16 and y2 - y1 >= 16:
            rgb_image = rgb_image[y1:y2, x1:x2]

    return Image.fromarray(rgb_image, mode="RGB")


def full_frame_quad_candidates(rgb_image):
    """画像の四隅をカード四隅として返す。輪郭検出は行わない。"""

    image_height, image_width = rgb_image.shape[:2]

    quad = np.array(
        [
            [0, 0],
            [image_width - 1, 0],
            [image_width - 1, image_height - 1],
            [0, image_height - 1],
        ],
        dtype=np.float32,
    )

    return [
        {
            "quad": quad,
            "score": 1.0,
            "normalized_quad_score": 1.0,
            "method": "split_card_full_frame",
        }
    ]


def extract_multiscan_rank_pairs_from_split_card(image):
    """分離カード全体を直接正規化してV2ランク候補を作る。"""

    direct_image = prepare_split_card_direct_image(image)
    direct_rgb = np.array(direct_image.convert("RGB"))
    quad_candidates = full_frame_quad_candidates(direct_rgb)

    candidates = extract_multiscan_rank_pairs(
        direct_image,
        quad_candidates=quad_candidates,
    )

    for candidate in candidates:
        candidate["input_mode"] = "split_card_direct"
        candidate["quad_method"] = "split_card_full_frame"

    # 直接入力が完全に失敗した場合のみ、従来方式へ戻す。
    if (
        ALLOW_RANK_REDETECT_FALLBACK
        and candidates
        and float(candidates[0].get("score", 0.0)) <= 0.0
    ):
        fallback_candidates = extract_multiscan_rank_pairs(image)
        for candidate in fallback_candidates:
            candidate["input_mode"] = "redetect_fallback"
        return fallback_candidates

    return candidates


def prepare_unknown_sample(
    image_path
):
    source_image = Image.open(
        image_path
    ).convert("RGB")

    candidates = (
        extract_multiscan_rank_pairs_from_split_card(
            source_image
        )
    )

    temporary_directory = _UNKNOWN_CANDIDATE_DIR

    if temporary_directory.exists():
        shutil.rmtree(
            temporary_directory
        )

    temporary_directory.mkdir(
        parents=True,
        exist_ok=True
    )

    saved_candidates = []

    for candidate_index, candidate in enumerate(
        candidates
    ):
        top_path = (
            temporary_directory
            / f"{candidate_index:02d}_top.png"
        )

        bottom_path = (
            temporary_directory
            / f"{candidate_index:02d}_bottom.png"
        )

        Image.fromarray(
            candidate[
                "top_image"
            ]
        ).save(
            top_path
        )

        Image.fromarray(
            candidate[
                "bottom_image"
            ]
        ).save(
            bottom_path
        )

        saved = {
            key: value
            for key, value
            in candidate.items()
            if key not in [
                "top_image",
                "bottom_image"
            ]
        }

        saved[
            "top_path"
        ] = str(
            top_path
        )

        saved[
            "bottom_path"
        ] = str(
            bottom_path
        )

        saved[
            "quad"
        ] = (
            np.asarray(
                saved["quad"]
            ).tolist()
        )

        saved_candidates.append(
            saved
        )

    return {
        "path": str(
            image_path
        ),
        "candidates": (
            saved_candidates
        ),
        "best_extraction_score": (
            saved_candidates[0][
                "score"
            ]
        )
    }

