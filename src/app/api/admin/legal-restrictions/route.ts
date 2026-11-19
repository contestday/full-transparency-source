import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { handle, json, parseJson } from "@/lib/http";
import { auditStaff } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Separately VERIFIED legal restrictions (e.g. a court order the owner has seen).
 * Distinct from anonymous areas of concern, which are never legally binding.
 */
const schema = z.object({
  title: z.string().trim().min(1).max(200),
  issuing_authority: z.string().trim().min(1).max(200),
  authority_reference: z.string().trim().max(200).nullable().optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  valid_from: z.iso.date().nullable().optional(),
  valid_until: z.iso.date().nullable().optional(),
  verification_notes: z.string().trim().min(1, "Record how this was verified").max(2000),
});

export const GET = handle(async () => {
  const { supabase } = await requireRole(["admin"]);
  const { data, error } = await supabase.from("legal_restrictions").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  return json({ restrictions: data });
});

export const POST = handle(async (request: Request) => {
  const { supabase, user } = await requireRole(["admin"]);
  const input = await parseJson(request, schema);
  const { data, error } = await supabase
    .from("legal_restrictions")
    .insert({ ...input, verified_at: new Date().toISOString(), verified_by: user.id })
    .select("*")
    .single();
  if (error) throw error;
  await auditStaff(supabase, user.id, { action: "legal_restriction.recorded", resourceType: "legal_restriction", resourceId: data.id });
  return json({ restriction: data }, { status: 201 });
});
