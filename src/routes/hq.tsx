/**
 * /hq — private super-admin panel. Top-level route, ssr:false so the page
 * does not try to verify auth during prerender. Owner check runs server-side
 * on every action (see src/lib/hq.functions.ts). Non-owners see a generic
 * 404 page and have zero ability to mutate data.
 */
import { createFileRoute, redirect } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import {
  hqAmOwner,
  hqListUsers,
  hqSuspendUser,
  hqSoftDeleteUser,
  hqRestoreUser,
  hqSetPlan,
  hqListSubscriptions,
  hqListOffers,
  hqCreateOffer,
  hqUpdateOffer,
  hqDeleteOffer,
  hqListNotifications,
  hqCreateNotification,
  hqToggleNotification,
  hqDeleteNotification,
  type HqUserRow,
  type HqSubsSnapshot,
} from "@/lib/hq.functions";

export const Route = createFileRoute("/hq")({
  ssr: false,
  head: () => ({ meta: [{ title: "Not found" }] }),
  beforeLoad: async ({ location }) => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      throw redirect({ to: "/auth", search: { redirect: location.href } as never });
    }
  },
  component: HqPage,
});

type Tab = "users" | "subs" | "offers" | "notifs";

function HqPage() {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const checkOwner = useServerFn(hqAmOwner);

  useEffect(() => {
    void (async () => {
      try {
        const r = await checkOwner();
        setAllowed(r.isOwner);
      } catch {
        setAllowed(false);
      }
    })();
  }, [checkOwner]);

  const [tab, setTab] = useState<Tab>("users");

  if (allowed === null) {
    return (
      <div className="grid min-h-screen place-items-center bg-background text-text-2 text-sm">
        Loading…
      </div>
    );
  }
  if (!allowed) {
    return (
      <div className="grid min-h-screen place-items-center bg-background">
        <div className="text-center">
          <h1 className="font-display text-2xl">Not found</h1>
          <p className="mt-2 text-sm text-text-2">The page you’re looking for doesn’t exist.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="flex items-center justify-between border-b border-border bg-surface-1 px-5 py-3">
        <div className="flex items-center gap-3">
          <span className="grid h-7 w-7 place-items-center rounded-md bg-vault text-vault-foreground text-[11px] font-bold">
            HQ
          </span>
          <div>
            <h1 className="font-display text-[15px] leading-none">VaultPDF · Headquarters</h1>
            <p className="mt-1 text-[11px] text-text-2">Owner-only control panel</p>
          </div>
        </div>
        <a href="/workspace" className="text-[12.5px] text-text-2 hover:text-foreground">
          ← Back to workspace
        </a>
      </header>

      <nav className="flex gap-1 border-b border-border bg-surface-1 px-5">
        {(
          [
            ["users", "Users"],
            ["subs", "Subscriptions"],
            ["offers", "Offers"],
            ["notifs", "Notifications"],
          ] as Array<[Tab, string]>
        ).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`-mb-px border-b-2 px-3 py-2 text-[12.5px] transition-colors ${
              tab === id
                ? "border-vault text-foreground"
                : "border-transparent text-text-2 hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </nav>

      <main className="mx-auto max-w-7xl p-5">
        {tab === "users" && <UsersTab />}
        {tab === "subs" && <SubsTab />}
        {tab === "offers" && <OffersTab />}
        {tab === "notifs" && <NotifsTab />}
      </main>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Users
// ─────────────────────────────────────────────────────────────────────────

function UsersTab() {
  const listUsers = useServerFn(hqListUsers);
  const suspendUser = useServerFn(hqSuspendUser);
  const softDelete = useServerFn(hqSoftDeleteUser);
  const restore = useServerFn(hqRestoreUser);
  const setPlan = useServerFn(hqSetPlan);

  const [rows, setRows] = useState<HqUserRow[] | null>(null);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const reload = useCallback(
    (silent = false) => {
      if (!silent) setRows(null);
      void listUsers().then(setRows);
    },
    [listUsers],
  );
  useEffect(() => reload(false), [reload]);

  const filtered = useMemo(() => {
    if (!rows) return null;
    const term = q.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter(
      (r) =>
        r.email?.toLowerCase().includes(term) ||
        r.fullName?.toLowerCase().includes(term) ||
        r.userId.includes(term),
    );
  }, [rows, q]);

  const patchRow = (id: string, patch: Partial<HqUserRow>) =>
    setRows((cur) => (cur ? cur.map((r) => (r.userId === id ? { ...r, ...patch } : r)) : cur));

  const act = async (
    id: string,
    fn: () => Promise<unknown>,
    optimistic?: Partial<HqUserRow>,
  ) => {
    if (optimistic) patchRow(id, optimistic);
    setBusy(id);
    try {
      await fn();
      reload(true);
    } catch (e) {
      alert((e as Error).message);
      reload(true);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search email, name, or user id…"
          className="w-80 rounded-md border border-border bg-surface-1 px-3 py-1.5 text-[13px]"
        />
        <div className="text-[12px] text-text-2">{filtered?.length ?? 0} user(s)</div>
      </div>
      <div className="overflow-hidden rounded-md border border-border">
        <table className="w-full text-[12.5px]">
          <thead className="bg-surface-1 text-left text-text-2">
            <tr>
              <th className="px-3 py-2 font-medium">Email</th>
              <th className="px-3 py-2 font-medium">Plan</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Signed up</th>
              <th className="px-3 py-2 font-medium">Last sign-in</th>
              <th className="px-3 py-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered?.map((u) => (
              <tr key={u.userId} className="border-t border-border">
                <td className="px-3 py-2">
                  <div className="font-medium">{u.email ?? "—"}</div>
                  <div className="text-[11px] text-text-2">{u.userId.slice(0, 8)}…</div>
                </td>
                <td className="px-3 py-2">
                  <select
                    value={u.plan}
                    disabled={busy === u.userId}
                    onChange={(e) => {
                      const next = e.target.value as "free" | "solo" | "firm";
                      void act(
                        u.userId,
                        () =>
                          setPlan({
                            data: { userId: u.userId, plan: next, status: "active" },
                          }),
                        { plan: next, subscriptionStatus: "active" },
                      );
                    }}
                    className="rounded border border-border bg-surface-1 px-1.5 py-1 text-[12px]"
                  >
                    <option value="free">free</option>
                    <option value="solo">solo</option>
                    <option value="firm">firm</option>
                  </select>
                </td>
                <td className="px-3 py-2">
                  {u.deletedAt ? (
                    <span className="text-red-400">deleted</span>
                  ) : u.suspendedAt ? (
                    <span className="text-amber-400">suspended</span>
                  ) : (
                    <span className="text-green-400">active</span>
                  )}
                </td>
                <td className="px-3 py-2 text-text-2">
                  {u.createdAt ? new Date(u.createdAt).toLocaleDateString() : "—"}
                </td>
                <td className="px-3 py-2 text-text-2">
                  {u.lastSignInAt ? new Date(u.lastSignInAt).toLocaleString() : "—"}
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-1.5">
                    {u.suspendedAt ? (
                      <button
                        disabled={busy === u.userId}
                        onClick={() =>
                          act(u.userId, () =>
                            suspendUser({ data: { userId: u.userId, suspend: false } }),
                          )
                        }
                        className="rounded border border-border px-2 py-0.5 hover:bg-surface-2"
                      >
                        Unsuspend
                      </button>
                    ) : (
                      <button
                        disabled={busy === u.userId}
                        onClick={() =>
                          act(u.userId, () =>
                            suspendUser({ data: { userId: u.userId, suspend: true } }),
                          )
                        }
                        className="rounded border border-border px-2 py-0.5 hover:bg-surface-2"
                      >
                        Suspend
                      </button>
                    )}
                    {u.deletedAt ? (
                      <button
                        disabled={busy === u.userId}
                        onClick={() => act(u.userId, () => restore({ data: { userId: u.userId } }))}
                        className="rounded border border-border px-2 py-0.5 hover:bg-surface-2"
                      >
                        Restore
                      </button>
                    ) : (
                      <button
                        disabled={busy === u.userId}
                        onClick={() => {
                          if (!confirm(`Soft-delete ${u.email ?? u.userId}?`)) return;
                          void act(u.userId, () => softDelete({ data: { userId: u.userId } }));
                        }}
                        className="rounded border border-red-500/40 px-2 py-0.5 text-red-400 hover:bg-red-500/10"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {filtered && filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-text-2">
                  No users match
                </td>
              </tr>
            )}
            {!filtered && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-text-2">
                  Loading…
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Subscriptions
// ─────────────────────────────────────────────────────────────────────────

function SubsTab() {
  const list = useServerFn(hqListSubscriptions);
  const [snap, setSnap] = useState<HqSubsSnapshot | null>(null);
  useEffect(() => {
    void list().then(setSnap);
  }, [list]);

  if (!snap)
    return <div className="text-[12.5px] text-text-2">Loading subscriptions…</div>;

  const stripeNote =
    "Stripe isn’t connected yet — figures reflect local subscription rows. Refunds and live invoices appear here once Stripe is enabled.";

  return (
    <section>
      <div className="mb-4 grid grid-cols-3 gap-3">
        <Stat label="MRR (cents)" value={`$${(snap.mrrCents / 100).toFixed(2)}`} />
        <Stat label="Active subscribers" value={String(snap.totalActive)} />
        <Stat
          label="By plan"
          value={Object.entries(snap.byPlan)
            .map(([k, v]) => `${k}:${v}`)
            .join(" · ") || "—"}
        />
      </div>
      <p className="mb-3 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[12px] text-amber-300">
        {stripeNote}
      </p>
      <div className="overflow-hidden rounded-md border border-border">
        <table className="w-full text-[12.5px]">
          <thead className="bg-surface-1 text-left text-text-2">
            <tr>
              <th className="px-3 py-2 font-medium">Email</th>
              <th className="px-3 py-2 font-medium">Plan</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Renews</th>
              <th className="px-3 py-2 font-medium">Stripe customer</th>
            </tr>
          </thead>
          <tbody>
            {snap.rows.map((r) => (
              <tr key={r.userId} className="border-t border-border">
                <td className="px-3 py-2">{r.email ?? r.userId.slice(0, 8)}</td>
                <td className="px-3 py-2">{r.plan}</td>
                <td className="px-3 py-2">{r.status}</td>
                <td className="px-3 py-2 text-text-2">
                  {r.currentPeriodEnd
                    ? new Date(r.currentPeriodEnd).toLocaleDateString()
                    : "—"}
                </td>
                <td className="px-3 py-2 text-text-2">
                  {r.stripeCustomerId ? (
                    <a
                      href={`https://dashboard.stripe.com/customers/${r.stripeCustomerId}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-vault hover:underline"
                    >
                      {r.stripeCustomerId.slice(0, 14)}…
                    </a>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-surface-1 px-4 py-3">
      <div className="text-[11px] uppercase tracking-wide text-text-2">{label}</div>
      <div className="mt-1 font-display text-lg">{value}</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Offers
// ─────────────────────────────────────────────────────────────────────────

type OfferRowDb = {
  id: string;
  name: string;
  description: string | null;
  discount_type: "percent" | "amount";
  discount_value: number;
  stripe_coupon_id: string | null;
  checkout_url: string | null;
  starts_at: string | null;
  ends_at: string | null;
  enabled: boolean;
  target_plan: "all" | "free" | "solo" | "firm";
};

function OffersTab() {
  const list = useServerFn(hqListOffers);
  const create = useServerFn(hqCreateOffer);
  const update = useServerFn(hqUpdateOffer);
  const del = useServerFn(hqDeleteOffer);

  const [rows, setRows] = useState<OfferRowDb[] | null>(null);
  const reload = useCallback(() => {
    void list().then((r) => setRows(r as OfferRowDb[]));
  }, [list]);
  useEffect(reload, [reload]);

  const [form, setForm] = useState({
    name: "",
    description: "",
    discountType: "percent" as "percent" | "amount",
    discountValue: 10,
    stripeCouponId: "",
    checkoutUrl: "",
    targetPlan: "all" as "all" | "free" | "solo" | "firm",
    enabled: true,
  });

  const submit = async () => {
    try {
      await create({
        data: {
          name: form.name,
          description: form.description || null,
          discountType: form.discountType,
          discountValue: Number(form.discountValue),
          stripeCouponId: form.stripeCouponId || null,
          checkoutUrl: form.checkoutUrl || null,
          targetPlan: form.targetPlan,
          enabled: form.enabled,
        },
      });
      setForm({ ...form, name: "", description: "" });
      reload();
    } catch (e) {
      alert((e as Error).message);
    }
  };

  return (
    <section>
      <div className="mb-5 rounded-md border border-border bg-surface-1 p-4">
        <h2 className="mb-3 font-display text-[14px]">New offer</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <Input label="Name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
          <Input
            label="Description"
            value={form.description}
            onChange={(v) => setForm({ ...form, description: v })}
          />
          <div className="flex gap-2">
            <Select
              label="Type"
              value={form.discountType}
              onChange={(v) => setForm({ ...form, discountType: v as "percent" | "amount" })}
              options={[
                ["percent", "% off"],
                ["amount", "$ off"],
              ]}
            />
            <Input
              label="Value"
              type="number"
              value={String(form.discountValue)}
              onChange={(v) => setForm({ ...form, discountValue: Number(v) })}
            />
          </div>
          <Input
            label="Stripe coupon id (optional)"
            value={form.stripeCouponId}
            onChange={(v) => setForm({ ...form, stripeCouponId: v })}
          />
          <Input
            label="Checkout URL (CTA)"
            value={form.checkoutUrl}
            onChange={(v) => setForm({ ...form, checkoutUrl: v })}
          />
          <Select
            label="Target plan"
            value={form.targetPlan}
            onChange={(v) => setForm({ ...form, targetPlan: v as typeof form.targetPlan })}
            options={[
              ["all", "All"],
              ["free", "Free"],
              ["solo", "Solo"],
              ["firm", "Firm"],
            ]}
          />
          <label className="flex items-end gap-2 text-[12.5px]">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
            />
            Enabled
          </label>
        </div>
        <button
          onClick={submit}
          disabled={!form.name}
          className="mt-3 rounded-md bg-vault px-3 py-1.5 text-[12.5px] font-medium text-vault-foreground disabled:opacity-40"
        >
          Create offer
        </button>
      </div>

      <div className="overflow-hidden rounded-md border border-border">
        <table className="w-full text-[12.5px]">
          <thead className="bg-surface-1 text-left text-text-2">
            <tr>
              <th className="px-3 py-2 font-medium">Name</th>
              <th className="px-3 py-2 font-medium">Discount</th>
              <th className="px-3 py-2 font-medium">Target</th>
              <th className="px-3 py-2 font-medium">Enabled</th>
              <th className="px-3 py-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows?.map((o) => (
              <tr key={o.id} className="border-t border-border">
                <td className="px-3 py-2">
                  <div className="font-medium">{o.name}</div>
                  {o.description && <div className="text-[11px] text-text-2">{o.description}</div>}
                </td>
                <td className="px-3 py-2">
                  {o.discount_type === "percent" ? `${o.discount_value}%` : `$${o.discount_value}`}
                </td>
                <td className="px-3 py-2">{o.target_plan}</td>
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    checked={o.enabled}
                    onChange={async (e) => {
                      await update({ data: { id: o.id, enabled: e.target.checked } });
                      reload();
                    }}
                  />
                </td>
                <td className="px-3 py-2">
                  <button
                    onClick={async () => {
                      if (!confirm(`Delete offer “${o.name}”?`)) return;
                      await del({ data: { id: o.id } });
                      reload();
                    }}
                    className="rounded border border-red-500/40 px-2 py-0.5 text-red-400 hover:bg-red-500/10"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {rows && rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-text-2">
                  No offers yet
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Notifications
// ─────────────────────────────────────────────────────────────────────────

type NotifDb = {
  id: string;
  title: string;
  body: string | null;
  link_url: string | null;
  target_plan: "all" | "free" | "solo" | "firm";
  enabled: boolean;
};

function NotifsTab() {
  const list = useServerFn(hqListNotifications);
  const create = useServerFn(hqCreateNotification);
  const toggle = useServerFn(hqToggleNotification);
  const del = useServerFn(hqDeleteNotification);

  const [rows, setRows] = useState<NotifDb[] | null>(null);
  const reload = useCallback(() => {
    void list().then((r) => setRows(r as NotifDb[]));
  }, [list]);
  useEffect(reload, [reload]);

  const [form, setForm] = useState({
    title: "",
    body: "",
    linkUrl: "",
    targetPlan: "all" as "all" | "free" | "solo" | "firm",
    enabled: true,
  });

  const submit = async () => {
    try {
      await create({
        data: {
          title: form.title,
          body: form.body || null,
          linkUrl: form.linkUrl || null,
          targetPlan: form.targetPlan,
          enabled: form.enabled,
        },
      });
      setForm({ ...form, title: "", body: "", linkUrl: "" });
      reload();
    } catch (e) {
      alert((e as Error).message);
    }
  };

  return (
    <section>
      <div className="mb-5 rounded-md border border-border bg-surface-1 p-4">
        <h2 className="mb-3 font-display text-[14px]">New notification</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <Input label="Title" value={form.title} onChange={(v) => setForm({ ...form, title: v })} />
          <Input label="Body" value={form.body} onChange={(v) => setForm({ ...form, body: v })} />
          <Input
            label="Link URL"
            value={form.linkUrl}
            onChange={(v) => setForm({ ...form, linkUrl: v })}
          />
          <Select
            label="Target plan"
            value={form.targetPlan}
            onChange={(v) => setForm({ ...form, targetPlan: v as typeof form.targetPlan })}
            options={[
              ["all", "All"],
              ["free", "Free"],
              ["solo", "Solo"],
              ["firm", "Firm"],
            ]}
          />
          <label className="flex items-end gap-2 text-[12.5px]">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
            />
            Enabled
          </label>
        </div>
        <button
          onClick={submit}
          disabled={!form.title}
          className="mt-3 rounded-md bg-vault px-3 py-1.5 text-[12.5px] font-medium text-vault-foreground disabled:opacity-40"
        >
          Send notification
        </button>
      </div>

      <div className="overflow-hidden rounded-md border border-border">
        <table className="w-full text-[12.5px]">
          <thead className="bg-surface-1 text-left text-text-2">
            <tr>
              <th className="px-3 py-2 font-medium">Title</th>
              <th className="px-3 py-2 font-medium">Target</th>
              <th className="px-3 py-2 font-medium">Enabled</th>
              <th className="px-3 py-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows?.map((n) => (
              <tr key={n.id} className="border-t border-border">
                <td className="px-3 py-2">
                  <div className="font-medium">{n.title}</div>
                  {n.body && <div className="text-[11px] text-text-2">{n.body}</div>}
                </td>
                <td className="px-3 py-2">{n.target_plan}</td>
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    checked={n.enabled}
                    onChange={async (e) => {
                      await toggle({ data: { id: n.id, enabled: e.target.checked } });
                      reload();
                    }}
                  />
                </td>
                <td className="px-3 py-2">
                  <button
                    onClick={async () => {
                      if (!confirm(`Delete notification “${n.title}”?`)) return;
                      await del({ data: { id: n.id } });
                      reload();
                    }}
                    className="rounded border border-red-500/40 px-2 py-0.5 text-red-400 hover:bg-red-500/10"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {rows && rows.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-text-2">
                  No notifications yet
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// shared inputs
// ─────────────────────────────────────────────────────────────────────────

function Input({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <label className="block text-[12px] text-text-2">
      <span className="mb-1 block">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded border border-border bg-background px-2 py-1.5 text-[12.5px] text-foreground"
      />
    </label>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<[string, string]>;
}) {
  return (
    <label className="block text-[12px] text-text-2">
      <span className="mb-1 block">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded border border-border bg-background px-2 py-1.5 text-[12.5px] text-foreground"
      >
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}
