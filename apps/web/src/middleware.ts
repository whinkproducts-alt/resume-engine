import { NextResponse, type NextRequest } from "next/server";
import { apiOrigin } from "@/lib/api-origin";

/**
 * Proxies /v1/* to the API (01-SPEC-v3.md section 7). The browser only ever talks to this
 * origin, so the HttpOnly refresh cookie (Path=/v1/auth) is first party and no CORS is needed.
 */
export function middleware(req: NextRequest) {
  return NextResponse.rewrite(new URL(req.nextUrl.pathname + req.nextUrl.search, apiOrigin()));
}

export const config = { matcher: "/v1/:path*" };
