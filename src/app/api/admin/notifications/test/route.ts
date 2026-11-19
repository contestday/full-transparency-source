import { requireRole } from "@/lib/auth";
import { handle, json } from "@/lib/http";
import { notifyAdmins } from "@/lib/notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = handle(async () => {
  await requireRole(["admin"]);
  const result = await notifyAdmins({
    event: "test",
    title: "Test notification",
    body: `Full Transparency alerts are working (${new Date().toUTCString()}).`,
    url: "/admin/settings",
  });
  return json(result);
});
