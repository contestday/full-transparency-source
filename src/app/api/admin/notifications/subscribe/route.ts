import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { handle, json, parseJson } from "@/lib/http";
import { auditStaff } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.discriminatedUnion("channel", [
  z.object({
    channel: z.literal("web_push"),
    endpoint: z.url().refine((u) => u.startsWith("https://"), "Push endpoint must be HTTPS"),
    keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }),
  }),
  z.object({ channel: z.literal("email"), endpoint: z.email() }),
]);

export const GET = handle(async () => {
  const { supabase } = await requireRole(["admin"]);
  const [{ data: subs }, { data: deliveries }] = await Promise.all([
    supabase.from("notification_subscriptions").select("id, channel, endpoint, enabled, created_at").order("created_at"),
    supabase.from("notification_deliveries").select("*").order("created_at", { ascending: false }).limit(50),
  ]);
  return json({
    subscriptions: (subs ?? []).map((s) => ({
      ...s,
      endpoint: s.channel === "web_push" ? `${new URL(s.endpoint).host}/…` : s.endpoint,
    })),
    deliveries,
  });
});

export const POST = handle(async (request: Request) => {
  const { supabase, user } = await requireRole(["admin"]);
  const input = await parseJson(request, schema);
  const { data, error } = await supabase
    .from("notification_subscriptions")
    .upsert(
      {
        owner_id: user.id,
        channel: input.channel,
        endpoint: input.endpoint,
        keys: input.channel === "web_push" ? input.keys : null,
        enabled: true,
      },
      { onConflict: "channel,endpoint" },
    )
    .select("id")
    .single();
  if (error) throw error;
  await auditStaff(supabase, user.id, { action: "notification.subscribed", resourceType: "notification_subscription", resourceId: data.id, metadata: { channel: input.channel } });
  return json({ id: data.id }, { status: 201 });
});

export const DELETE = handle(async (request: Request) => {
  const { supabase, user } = await requireRole(["admin"]);
  const id = z.uuid().parse(new URL(request.url).searchParams.get("id"));
  const { error } = await supabase.from("notification_subscriptions").delete().eq("id", id).eq("owner_id", user.id);
  if (error) throw error;
  await auditStaff(supabase, user.id, { action: "notification.unsubscribed", resourceType: "notification_subscription", resourceId: id });
  return json({ ok: true });
});
