# Hand History (仮)

トランプをスマホのカメラで撮るだけで、ランクとスートを自動認識して
ポーカーのハンドヒストリーを記録・保存・共有できる Web アプリ。

対面のリアルなポーカーで、①自分のホールカード2枚をまとめて撮影 →
②ボード（3〜5枚）をまとめて撮影 → ③ポジション・アクション・ベット額（任意）を
入力 → 保存し、後から見返したり友人と共有（文字 / 画像 / アニメーション）できる。

> サービス名・アプリアイコンは未定（仮）。

## 構成（モノレポ）

```
apps/web/               Next.js 14（App Router / TypeScript / Tailwind）
                        カメラ撮影・記録・リプレイ・共有・Supabase Auth
services/recognition/   FastAPI（Python）カード認識マイクロサービス
                        ・card_splitter … 1枚の写真から複数カードを分離
                        ・suit_model    … スート判定 CNN（PyTorch）
                        ・rank_model    … ランク判定 HOG+SVM+テンプレート照合
                        ・pipeline      … カードごとにプロセス並列で認識
packages/engine/        ポーカールールエンジン（Meta-GEO から流用・役判定に使用）
research/notebooks/     元の学習・研究用ノートブック（証跡・再学習用）
docs/DEPLOYMENT.md      Vercel / Fly.io / Supabase へのデプロイ手順
```

### 既存資産の流用（ユーザー承認済み）

- **認識モデル**: ユーザー提供の Colab 資産（CNN / HOG+SVM）をアルゴリズムを
  変えずに Python サービスへ移植。
- **ポーカーロジック・カード/テーブルデザイン**: `Coffiest/Meta---GEO` から流用
  （役判定エンジン、`public/cards/{rank}{suit}.png` のカード画像と命名規則、
  白基調 + ゴールド #F2A900 の Apple-native デザイントークン）。
- **認証**: Supabase Auth（Google / Apple / メールMagicLink）を Meta-GEO から流用。

## カメラ UI

カメラ起動中は、高速な検出専用エンドポイント（`/v1/detect`）を数回/秒ポーリングし、
**認識中のカードにリアルタイムで枠（近未来的なブラケット + スキャン光）を重ねて表示**する。
シャッターで高解像度撮影 → 数秒の認識待ち → 結果確認（信頼度バッジ + 手動修正）の流れ。

正面からの撮影に加え、カードを射影変換で正面化するため、多少斜めに置いた・
持った状態でも認識できる（強く重なった手持ちカードは検出が難しい場合がある）。

## 開発

```bash
pnpm install
# DB + 認識サービス + Web をまとめて起動
docker compose up
```

個別起動やデプロイは [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md) を参照。

## テスト

```bash
# ポーカーエンジン（68 tests）
pnpm --filter @handhistory/engine test
# 認識パイプラインのスモークテスト（要 Python 依存）
cd services/recognition && python -m pytest
```

## この環境で未検証の項目

実物のトランプ画像・OAuth 実クレデンシャル・Docker 実ビルドが無いため、
認識精度 / 実ログイン / Docker ビルドは未検証（`docs/DEPLOYMENT.md` に明記）。
コードとパイプラインが端から端まで動作することは、合成画像による自動テストと
ヘッドレスブラウザでの操作確認で担保している。
