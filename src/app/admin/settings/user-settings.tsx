"use client";

import { useState } from "react";
import { Card, Notice, Select } from "@/components/ui";
import { api } from "@/lib/client-api";

interface U {
  id: string;
  email: string | null;
  role: string;
}

export function UserSettings({ users: initial, currentUserId }: { users: U[]; currentUserId: string }) {
  const [users, setUsers] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<{ id: string; role: string } | null>(null);

  async function setRole(u: U, role: string) {
    if (role !== "admin" && u.role === "admin" && pending?.id !== u.id) {
      setPending({ id: u.id, role });
      return;
    }
    setPending(null);
    setError(null);
    try {
      await api("/api/admin/users", { method: "POST", json: { id: u.id, role } });
      setUsers((us) => us.map((x) => (x.id === u.id ? { ...x, role } : x)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
    }
  }

  return (
    <Card className="space-y-3">
      <h2 className="text-lg font-semibold">Access</h2>
      <p className="text-sm text-muted">
        Invite users from the Supabase dashboard (Authentication → Users). New users have no access until given a role
        here. Reviewers can see reports and areas of concern, but never location data. Setting a role to
        &quot;No access&quot; revokes access immediately.
      </p>
      {error && <Notice tone="red">{error}</Notice>}
      <ul className="divide-y divide-border text-sm">
        {users.map((u) => (
          <li key={u.id} className="flex items-center justify-between gap-2 py-2">
            <span>
              {u.email ?? u.id}
              {u.id === currentUserId && <span className="text-muted"> (you)</span>}
            </span>
            {pending?.id === u.id && (
              <span className="flex items-center gap-1 rounded bg-red-50 px-2 py-1 text-xs text-red-900">
                Remove admin access?
                <button type="button" className="font-semibold underline" onClick={() => setRole(u, pending.role)}>
                  Yes
                </button>
                <button type="button" className="underline" onClick={() => setPending(null)}>
                  No
                </button>
              </span>
            )}
            <Select value={u.role} onChange={(e) => setRole(u, e.target.value)} disabled={u.id === currentUserId} className="w-auto" aria-label={`Role for ${u.email}`}>
              <option value="none">No access</option>
              <option value="reviewer">Reviewer</option>
              <option value="admin">Administrator</option>
            </Select>
          </li>
        ))}
      </ul>
    </Card>
  );
}
