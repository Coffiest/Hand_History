import { NextResponse } from "next/server";

// Fast detection-only proxy for the live camera overlay (polled a few times/sec).
export const runtime = "nodejs";

const SERVICE_URL = process.env.RECOGNITION_SERVICE_URL ?? "http://localhost:8080";

export async function POST(req: Request): Promise<Response> {
  const form = await req.formData();
  const image = form.get("image");
  if (!(image instanceof Blob)) {
    return NextResponse.json({ error: "No image" }, { status: 400 });
  }

  const forward = new FormData();
  forward.append("image", image, "frame.jpg");

  try {
    const res = await fetch(`${SERVICE_URL}/v1/detect`, { method: "POST", body: forward });
    const body = await res.text();
    return new NextResponse(body, {
      status: res.status,
      headers: { "content-type": res.headers.get("content-type") ?? "application/json" },
    });
  } catch {
    return NextResponse.json({ error: "recognition service unreachable" }, { status: 502 });
  }
}
