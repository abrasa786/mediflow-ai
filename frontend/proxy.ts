import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// clinic.mediflowai.in → the /clinic portal (same Next.js app, separate entry point)
export function proxy(request: NextRequest) {
  const host = request.headers.get("host") || "";
  const { pathname } = request.nextUrl;
  if (!host.startsWith("clinic.")) return NextResponse.next();
  // Shared public pages stay as they are
  if (pathname.startsWith("/clinic") || pathname.startsWith("/driver") || pathname.startsWith("/medipass")) {
    return NextResponse.next();
  }
  const url = request.nextUrl.clone();
  url.pathname = `/clinic${pathname === "/" ? "" : pathname}`;
  return NextResponse.rewrite(url);
}

export const config = {
  // Skip Next internals and static files
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|ico|webp)$).*)"],
};
