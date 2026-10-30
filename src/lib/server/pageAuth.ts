import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ADMIN_COOKIE } from "../auth/session";
import { container } from "./container";

/** For admin server pages: no valid admin session → login page. Every admin page calls this itself. */
export async function requireAdminPage() {
  const token = (await cookies()).get(ADMIN_COOKIE)?.value;
  const claims = container().auth.verify(token);
  if (!claims) redirect("/admin/login");
  return claims;
}
