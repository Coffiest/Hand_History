import { NextResponse } from "next/server";

// Proxy the captured photo to the Python recognition microservice. Keeping the
// service URL server-side means the browser never needs to know it (and it can
// live on a private Fly.io network).
export const runtime = "nodejs";
export const maxDuration = 120;

const SERVICE_URL = process.env.RECOGNITION_SERVICE_URL ?? "http://localhost:8080";

export async function POST(req: Request): Promise<Response> {
  const form = await req.formData();
  const image = form.get("image");
  if (!(image instanceof Blob)) {
    return NextResponse.json({ error: "No image" }, { status: 400 });
  }

  const forward = new FormData();
  forward.append("image", image, "capture.jpg");

  try {
    const res = await fetch(`${SERVICE_URL}/v1/recognize`, { method: "POST", body: forward });
    const body = await res.text();
    return new NextResponse(body, {
      status: res.status,
      headers: { "content-type": res.headers.get("content-type") ?? "application/json" },
    });
  } catch {
    return NextResponse.json({ error: "recognition service unreachable" }, { status: 502 });
  }
}
