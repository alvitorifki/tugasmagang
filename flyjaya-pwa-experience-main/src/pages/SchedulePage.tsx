import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { schedulesApi, crewsApi, Schedule, Crew } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { AppLayout } from "@/components/AppLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  ChevronLeft, ChevronRight, Plus, Plane, GraduationCap, Coffee, Clock,
  Trash2, CalendarDays, Pencil, Upload, Users, Download, FileSpreadsheet, X,
} from "lucide-react";
import { toast } from "sonner";
import {
  format, addMonths, startOfMonth, endOfMonth, eachDayOfInterval,
  isSameDay, parseISO, getDay,
} from "date-fns";

const TYPE_META: Record<string, { label: string; color: string; icon: any }> = {
  flight: { label: "Flight", color: "bg-primary-soft text-primary", icon: Plane },
  training: { label: "Training", color: "bg-warning-soft text-[hsl(var(--warning))]", icon: GraduationCap },
  off: { label: "Off", color: "bg-muted text-muted-foreground", icon: Coffee },
  standby: { label: "Standby", color: "bg-success-soft text-[hsl(var(--success))]", icon: Clock },
  medex: { label: "Medex", color: "bg-destructive/10 text-destructive", icon: Clock },
};

// ── Training options berdasarkan rank ──────────────────────────
const TRAINING_BY_RANK: Record<string, string[]> = {
  PIC: [
    "Company Basic Indoctrination",
    "CRM",
    "Windshear",
    "Dangerous Goods (DG)",
    "CET",
    "Aviation Security (AVSEC)",
    "SMS",
    "PBN",
    "ALAR/CFIT",
    "TCAS",
  ],
  SIC: [
    "Company Basic Indoctrination",
    "CRM",
    "Windshear",
    "Dangerous Goods (DG)",
    "CET",
    "Aviation Security (AVSEC)",
    "SMS",
    "PBN",
    "ALAR/CFIT",
    "TCAS",
  ],
  FA2: [
    "Company Basic Indoctrination",
    "CRM",
    "Dangerous Goods (DG)",
    "CET",
    "Aviation Security (AVSEC)",
    "SMS",
  ],
  FA1: [
    "Company Basic Indoctrination",
    "CRM",
    "Dangerous Goods (DG)",
    "CET",
    "Aviation Security (AVSEC)",
    "SMS",
  ],
  FOO: [
    "Company Basic Indoctrination",
    "DRM",
    "Dangerous Goods (DG)",
    "Aviation Security (AVSEC)",
    "SMS",
    "PBN",
  ],
};

// Semua jenis training yang tersedia (union dari semua rank)
const ALL_TRAINING_OPTIONS = Array.from(new Set(Object.values(TRAINING_BY_RANK).flat())).sort();

// Jenis training yang wajib untuk semua rank
const COMMON_TRAINING = ["Company Basic Indoctrination", "Dangerous Goods (DG)", "Aviation Security (AVSEC)", "SMS"];

function toDateInput(val: string | null | undefined): string {
  if (!val) return "";
  // Sudah format YYYY-MM-DD → kembalikan as-is TANPA new Date() agar tidak timezone-shift
  if (/^\d{4}-\d{2}-\d{2}$/.test(val)) return val;
  // ISO timestamp (misal dari DB lama): ambil 10 karakter UTC pertama
  if (val.includes("T") || val.includes("Z")) {
    const d = new Date(val);
    if (!isNaN(d.getTime())) {
      const yyyy = d.getUTCFullYear();
      const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
      const dd = String(d.getUTCDate()).padStart(2, "0");
      return `${yyyy}-${mm}-${dd}`;
    }
  }
  return "";
}

// ── Download CSV helper ──────────────────────────────────────
function downloadCsv(filename: string, rows: string[][], headers: string[]) {
  const csvContent = [headers, ...rows]
    .map(row => row.map(cell => `"${(cell || "").replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadPdf(title: string, headers: string[], rows: string[][]) {
  const tableRows = rows.map(row =>
    `<tr>${row.map(cell => `<td>${cell || "—"}</td>`).join("")}</tr>`
  ).join("");

  const html = `
    <!DOCTYPE html><html><head>
    <meta charset="UTF-8"><title>${title}</title>
    <style>
      body { font-family: Arial, sans-serif; padding: 20px; font-size: 11px; }
      h2 { color: #1e40af; margin-bottom: 4px; }
      .meta { color: #666; margin-bottom: 16px; font-size: 10px; }
      table { border-collapse: collapse; width: 100%; }
      th { background: #1e40af; color: white; padding: 6px 8px; text-align: left; font-size: 10px; }
      td { border: 1px solid #ddd; padding: 5px 8px; }
      tr:nth-child(even) { background: #f5f5f5; }
    </style></head><body>
    <h2>${title}</h2>
    <div class="meta">Generated: ${format(new Date(), "d MMMM yyyy HH:mm")} | FlyJaya</div>
    <table>
      <thead><tr>${headers.map(h => `<th>${h}</th>`).join("")}</tr></thead>
      <tbody>${tableRows}</tbody>
    </table>
    </body></html>`;

  const printWin = window.open("", "_blank", "width=900,height=700");
  if (!printWin) { toast.error("Popup diblokir. Izinkan popup lalu coba lagi."); return; }
  printWin.document.write(html);
  printWin.document.close();
  printWin.focus();
  setTimeout(() => { printWin.print(); }, 500);
}

export default function SchedulePage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin" || user?.role === "super_admin";

  const qc = useQueryClient();

  const [cursor, setCursor] = useState<Date>(new Date());
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Schedule | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [activityFilter, setActivityFilter] = useState("");
  const [dayDetailOpen, setDayDetailOpen] = useState(false);
  const [dayDetailItems, setDayDetailItems] = useState<Schedule[]>([]);
  const [dayDetailDate, setDayDetailDate] = useState<Date | null>(null);

  const year = cursor.getFullYear();
  const month = cursor.getMonth() + 1;

  const { data, isLoading } = useQuery({
    queryKey: ["schedules", year, month],
    queryFn: () => schedulesApi.list({ year, month }),
  });

  const summary = useQuery({
    queryKey: ["schedules-summary", year, month],
    queryFn: () => schedulesApi.summary(year, month),
    enabled: isAdmin,
  });

  const crewList = useQuery({
    queryKey: ["crews-for-schedule"],
    queryFn: () => crewsApi.list(),
    enabled: isAdmin,
  });

  const removeMutation = useMutation({
    mutationFn: (id: number) => schedulesApi.remove(id),
    onSuccess: () => {
      toast.success("Jadwal dihapus");
      qc.invalidateQueries({ queryKey: ["schedules"] });
      qc.invalidateQueries({ queryKey: ["schedules-summary"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const days = eachDayOfInterval({ start: startOfMonth(cursor), end: endOfMonth(cursor) });
  const leadingBlanks = getDay(startOfMonth(cursor));
  const schedules = data?.data ?? [];
  const filtered = activityFilter
    ? schedules.filter((s) =>
      s.activity?.toLowerCase().includes(activityFilter.toLowerCase()) ||
      s.type.toLowerCase().includes(activityFilter.toLowerCase()) ||
      s.crew_name?.toLowerCase().includes(activityFilter.toLowerCase())
    )
    : schedules;

  const openEdit = (s: Schedule) => { setEditing(s); setOpen(true); };
  const openAdd = () => { setEditing(null); setOpen(true); };

  // ── Download schedule bulan ini ───────────────────────────
  const handleDownloadSchedule = (fmt: "csv" | "pdf") => {
    const monthLabel = format(cursor, "MMMM yyyy");
    const headers = ["Tanggal", "Crew", "Role", "Type", "Aktivitas", "Tanggal Selesai", "Detail"];
    const rows = filtered.map(s => [
      s.date_start ? format(parseISO(toDateInput(s.date_start)!), "d MMM yyyy") : "—",
      s.crew_name || "—",
      s.crew_role || "—",
      TYPE_META[s.type]?.label || s.type,
      s.activity || "—",
      s.date_end ? format(parseISO(toDateInput(s.date_end)!), "d MMM yyyy") : "—",
      s.detail || "—",
    ]);
    const title = `Schedule ${monthLabel}`;
    if (fmt === "csv") {
      downloadCsv(`schedule-${format(cursor, "yyyy-MM")}.csv`, rows, headers);
      toast.success(`Download schedule ${monthLabel} berhasil`);
    } else {
      downloadPdf(title, headers, rows);
    }
  };

  return (
    <AppLayout>
      <div className="flex flex-col md:flex-row md:items-end gap-4 md:justify-between">
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
            Flight Schedule
          </div>
          <h1 className="text-2xl md:text-3xl font-extrabold mt-1">Monthly Schedule</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage flight operations and crew rotations for {format(cursor, "MMMM yyyy")}.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <Button size="icon" variant="outline" onClick={() => setCursor(addMonths(cursor, -1))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="secondary" onClick={() => setCursor(new Date())} className="font-semibold">
            Today
          </Button>
          <Button size="icon" variant="outline" onClick={() => setCursor(addMonths(cursor, 1))}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          {isAdmin && (
            <>
              <Button onClick={openAdd} className="font-semibold">
                <Plus className="h-4 w-4 mr-1.5" />Add
              </Button>
              <Button onClick={() => setBulkOpen(true)} variant="outline" className="font-semibold">
                <Upload className="h-4 w-4 mr-1.5" />Bulk
              </Button>
            </>
          )}
          {/* Download tersedia untuk semua user */}
          <Button onClick={() => handleDownloadSchedule("csv")} variant="outline" size="sm">
            <FileSpreadsheet className="h-4 w-4 mr-1.5" />Excel
          </Button>
          <Button onClick={() => handleDownloadSchedule("pdf")} variant="outline" size="sm">
            <Download className="h-4 w-4 mr-1.5" />PDF
          </Button>
        </div>
      </div>

      <Tabs defaultValue="calendar" className="mt-5">
        <TabsList>
          <TabsTrigger value="calendar">
            <CalendarDays className="h-4 w-4 mr-1.5" />Calendar
          </TabsTrigger>
          <TabsTrigger value="list">List</TabsTrigger>
          {isAdmin && <TabsTrigger value="summary">Summary</TabsTrigger>}
        </TabsList>

        {/* ── Calendar ── */}
        <TabsContent value="calendar" className="mt-4">
          <Card className="p-3 md:p-5">
            <div className="grid grid-cols-7 text-center text-[11px] uppercase tracking-wider text-muted-foreground font-semibold pb-2">
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
                <div key={d}>{d}</div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1 md:gap-2">
              {Array.from({ length: leadingBlanks }).map((_, i) => (
                <div key={`b-${i}`} />
              ))}
              {days.map((d) => {
                const items = schedules.filter((s) =>
                  isSameDay(parseISO(toDateInput(s.date_start)!), d)
                );
                const isToday = isSameDay(d, new Date());
                return (
                  <div
                    key={d.toISOString()}
                    className={`min-h-[72px] md:min-h-[110px] rounded-lg border p-1.5 md:p-2 text-left ${isToday ? "border-primary bg-primary-soft/40" : "border-border bg-card"
                      }`}
                  >
                    <div className={`text-xs font-bold ${isToday ? "text-primary" : "text-foreground"}`}>
                      {format(d, "d")}
                    </div>
                    <div className="mt-1 space-y-1">
                      {items.slice(0, 3).map((it) => {
                        const m = TYPE_META[it.type] || TYPE_META.standby;
                        return (
                          <div
                            key={it.id}
                            className={`text-[10px] md:text-[11px] rounded px-1.5 py-0.5 truncate cursor-pointer hover:opacity-80 ${m.color}`}
                            title={`${it.crew_name} · ${it.activity || it.type}`}
                            onClick={() => isAdmin && openEdit(it)}
                          >
                            <span className="font-semibold">{it.activity || m.label}</span>
                            <span className="hidden md:inline"> · {it.crew_name}</span>
                          </div>
                        );
                      })}
                      {items.length > 3 && (
                        <div
                          className="text-[10px] text-primary font-semibold cursor-pointer hover:underline"
                          onClick={(e) => { e.stopPropagation(); setDayDetailItems(items); setDayDetailDate(d); setDayDetailOpen(true); }}
                        >
                          +{items.length - 3} lainnya...
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        </TabsContent>

        {/* ── List ── */}
        <TabsContent value="list" className="mt-4">
          <div className="mb-3 flex gap-2 flex-wrap">
            <Input
              placeholder="Filter activity, type, atau nama crew..."
              value={activityFilter}
              onChange={(e) => setActivityFilter(e.target.value)}
              className="max-w-sm"
            />
            {/* Download tersedia untuk semua user */}
            <Button variant="outline" size="sm" onClick={() => handleDownloadSchedule("csv")}>
              <FileSpreadsheet className="h-3.5 w-3.5 mr-1.5" />Download Excel
            </Button>
            <Button variant="outline" size="sm" onClick={() => handleDownloadSchedule("pdf")}>
              <Download className="h-3.5 w-3.5 mr-1.5" />Download PDF
            </Button>
          </div>
          <Card>
            <div className="divide-y divide-border">
              {isLoading && (
                <div className="p-6 text-center text-muted-foreground">Loading...</div>
              )}
              {!isLoading && filtered.length === 0 && (
                <div className="p-8 text-center text-muted-foreground text-sm">
                  Belum ada jadwal di bulan ini.
                </div>
              )}
              {filtered.map((s) => {
                const m = TYPE_META[s.type] || TYPE_META.standby;
                const Icon = m.icon;
                return (
                  <div key={s.id} className="p-4 flex items-center gap-3 hover:bg-muted/20">
                    <div className={`h-10 w-10 rounded-lg flex items-center justify-center shrink-0 ${m.color}`}>
                      <Icon className="h-5 w-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold">
                        {s.activity || m.label} · {s.crew_name}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {s.crew_role} ·{" "}
                        {format(parseISO(toDateInput(s.date_start)!), "EEE, d MMM yyyy")}
                        {s.date_end
                          ? ` → ${format(parseISO(toDateInput(s.date_end)!), "d MMM")}`
                          : ""}
                        {s.detail ? ` · ${s.detail}` : ""}
                      </div>
                    </div>
                    {isAdmin && (
                      <div className="flex gap-1 shrink-0">
                        <Button size="icon" variant="ghost" onClick={() => openEdit(s)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon" variant="ghost"
                          onClick={() => {
                            if (confirm("Hapus jadwal?")) removeMutation.mutate(s.id);
                          }}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>
        </TabsContent>

        {/* ── Summary (Admin only) ── */}
        {isAdmin && (
          <TabsContent value="summary" className="mt-4">
            <div className="grid md:grid-cols-2 gap-4">
              <Card className="p-5">
                <h3 className="font-bold text-lg flex items-center gap-2">
                  <GraduationCap className="h-5 w-5 text-primary" />
                  By Activity
                </h3>
                <div className="mt-3 space-y-2">
                  {summary.data?.data.by_activity.map((a: any, i: number) => (
                    <div key={i} className="flex items-center justify-between gap-3 p-2 rounded-lg bg-muted/50">
                      <div className="min-w-0">
                        <div className="font-semibold truncate">{a.activity || "—"}</div>
                        <div className="text-xs text-muted-foreground">
                          {a.type} · {a.crew_role}
                        </div>
                        {a.crew_list?.length > 0 && (
                          <div className="text-[10px] text-muted-foreground mt-0.5 truncate">
                            {a.crew_list.slice(0, 3).join(", ")}
                            {a.crew_list.length > 3 ? ` +${a.crew_list.length - 3}` : ""}
                          </div>
                        )}
                      </div>
                      <div className="text-right shrink-0">
                        <div className="font-bold text-lg">{a.crew_count}</div>
                        <div className="text-[10px] text-muted-foreground uppercase">crew</div>
                      </div>
                    </div>
                  ))}
                  {summary.data?.data.by_activity.length === 0 && (
                    <div className="text-sm text-muted-foreground text-center py-4">
                      Tidak ada data.
                    </div>
                  )}
                </div>
              </Card>

              <Card className="p-5">
                <h3 className="font-bold text-lg flex items-center gap-2">
                  <Users className="h-5 w-5 text-primary" />
                  Active Crew
                </h3>
                <div className="mt-3 space-y-2">
                  {summary.data?.data.crews_active.map((c: any, i: number) => (
                    <div key={i} className="flex items-center justify-between gap-3 p-2 rounded-lg bg-muted/50">
                      <div className="min-w-0">
                        <div className="font-semibold truncate">{c.crew_name}</div>
                        <div className="text-xs text-muted-foreground">
                          {c.crew_role} · {c.activities.join(", ")}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="font-bold">{c.total_events}</div>
                        <div className="text-[10px] text-muted-foreground uppercase">events</div>
                      </div>
                    </div>
                  ))}
                  {summary.data?.data.crews_active.length === 0 && (
                    <div className="text-sm text-muted-foreground text-center py-4">
                      Tidak ada data.
                    </div>
                  )}
                </div>
              </Card>
            </div>
          </TabsContent>
        )}
      </Tabs>

      {/* ── Day Detail Popup ── */}
      <DayDetailDialog
        open={dayDetailOpen}
        onOpenChange={setDayDetailOpen}
        items={dayDetailItems}
        date={dayDetailDate}
        isAdmin={isAdmin}
        onEdit={(s) => { setDayDetailOpen(false); openEdit(s); }}
      />

      {isAdmin && (
        <ScheduleFormDialog
          open={open}
          onOpenChange={(v) => { setOpen(v); if (!v) setEditing(null); }}
          schedule={editing}
          crews={crewList.data?.data ?? []}
        />
      )}

      {isAdmin && (
        <BulkScheduleDialog
          open={bulkOpen}
          onOpenChange={setBulkOpen}
          crews={crewList.data?.data ?? []}
          defaultDate={format(cursor, "yyyy-MM-dd")}
        />
      )}
    </AppLayout>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ScheduleFormDialog — Add & Edit
// ─────────────────────────────────────────────────────────────────────────────
function ScheduleFormDialog({
  open, onOpenChange, schedule, crews,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  schedule: Schedule | null;
  crews: Crew[];
}) {
  const qc = useQueryClient();
  const isEdit = !!schedule;

  const emptyForm = (): Partial<Schedule> => ({
    type: "flight",
    date_start: format(new Date(), "yyyy-MM-dd"),
    date_end: "",
    crew_name: "",
    crew_role: "",
    crew_id: undefined,
    activity: "",
    detail: "",
  });

  function scheduleToForm(s: Schedule): Partial<Schedule> {
    return {
      ...s,
      date_start: toDateInput(s.date_start),
      date_end: toDateInput(s.date_end ?? ""),
    };
  }

  const [form, setForm] = useState<Partial<Schedule>>(
    schedule ? scheduleToForm(schedule) : emptyForm()
  );
  const [useCrewDropdown, setUseCrew] = useState(true);
  const [crewRankFilter, setCrewRankFilter] = useState<string>("all");
  const [crewSearchFilter, setCrewSearchFilter] = useState<string>("");

  useEffect(() => {
    if (open) {
      setForm(schedule ? scheduleToForm(schedule) : emptyForm());
      setUseCrew(true);
      setCrewRankFilter("all");
      setCrewSearchFilter("");
    }
  }, [schedule, open]);

  const filteredCrewsForSelect = crews.filter(c => {
    const matchRank = crewRankFilter === "all" || c.rank === crewRankFilter;
    const matchSearch = !crewSearchFilter ||
      c.name.toLowerCase().includes(crewSearchFilter.toLowerCase()) ||
      c.employee_id.toLowerCase().includes(crewSearchFilter.toLowerCase());
    return matchRank && matchSearch;
  });

  const setF = (k: keyof Schedule, v: any) =>
    setForm((f) => ({ ...f, [k]: v }));

  const handleCrewSelect = (crewId: string) => {
    if (crewId === "__manual__") {
      setUseCrew(false);
      setF("crew_id" as any, undefined);
      return;
    }
    const crew = crews.find((c) => String(c.id) === crewId);
    if (crew) {
      setForm((f) => ({
        ...f,
        crew_id: crew.id,
        crew_name: crew.name,
        crew_role: crew.rank,
      }));
    }
  };

  const mutation = useMutation({
    mutationFn: (data: Partial<Schedule>) =>
      isEdit
        ? schedulesApi.update(schedule!.id, data)
        : schedulesApi.create(data),
    onSuccess: () => {
      toast.success(isEdit ? "Jadwal diperbarui" : "Jadwal ditambahkan");
      qc.invalidateQueries({ queryKey: ["schedules"] });
      qc.invalidateQueries({ queryKey: ["schedules-summary"] });
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Jadwal" : "Tambah Jadwal"}</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => { e.preventDefault(); mutation.mutate(form); }}
          className="space-y-3"
        >
          <div className="space-y-1">
            <Label className="text-xs uppercase tracking-wider font-semibold">Type *</Label>
            <Select value={form.type} onValueChange={(v) => { setF("type", v as any); setF("activity", ""); }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(TYPE_META).map(([t, m]) => (
                  <SelectItem key={t} value={t}>{m.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label className="text-xs uppercase tracking-wider font-semibold">Crew</Label>
            {useCrewDropdown ? (
              <div className="space-y-1.5">
                <div className="flex gap-1.5">
                  <Input
                    placeholder="Cari nama / ID crew..."
                    value={crewSearchFilter}
                    onChange={(e) => setCrewSearchFilter(e.target.value)}
                    className="h-8 text-sm flex-1"
                  />
                  <Select value={crewRankFilter} onValueChange={setCrewRankFilter}>
                    <SelectTrigger className="h-8 w-[110px] text-sm">
                      <SelectValue placeholder="Semua" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Semua Rank</SelectItem>
                      {["PIC", "SIC", "FA1", "FA2", "FOO"].map(r => (
                        <SelectItem key={r} value={r}>{r}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Select
                  value={form.crew_id ? String(form.crew_id) : ""}
                  onValueChange={handleCrewSelect}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Pilih crew atau ketik manual..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__manual__">— Ketik manual —</SelectItem>
                    {filteredCrewsForSelect.map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>
                        {c.name} ({c.rank})
                      </SelectItem>
                    ))}
                    {filteredCrewsForSelect.length === 0 && (
                      <div className="py-2 px-3 text-xs text-muted-foreground">Tidak ada crew ditemukan.</div>
                    )}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <Input
                  placeholder="Nama crew"
                  value={form.crew_name || ""}
                  onChange={(e) => setF("crew_name", e.target.value)}
                />
                <div className="flex gap-2">
                  <Select
                    value={form.crew_role || ""}
                    onValueChange={(v) => setF("crew_role", v)}
                  >
                    <SelectTrigger><SelectValue placeholder="Role" /></SelectTrigger>
                    <SelectContent>
                      {["PIC", "SIC", "FA1", "FA2", "FOO"].map((r) => (
                        <SelectItem key={r} value={r}>{r}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    type="button" size="sm" variant="ghost"
                    onClick={() => setUseCrew(true)}
                    title="Kembali ke dropdown"
                  >↑</Button>
                </div>
              </div>
            )}
          </div>

          <div className="space-y-1">
            <Label className="text-xs uppercase tracking-wider font-semibold">
              Activity{form.type === "training" ? " *" : ""}
            </Label>
            {form.type === "medex" || form.type === "flight" ? (
              <div className="h-9 rounded-md border border-input bg-muted/40 px-3 py-2 text-sm text-muted-foreground flex items-center">
                {form.type === "medex" ? "Medex — tidak perlu activity" : "Flight — tidak perlu activity"}
              </div>
            ) : form.type === "training" ? (
              <TrainingActivitySelect
                value={form.activity || ""}
                onChange={(v) => setF("activity", v)}
                selectedCrews={form.crew_id ? (crews.filter(c => c.id === form.crew_id)) : []}
              />
            ) : (
              <Input
                value={form.activity || ""}
                onChange={(e) => setF("activity", e.target.value)}
                placeholder="Keterangan aktivitas..."
              />
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs uppercase tracking-wider font-semibold">Start *</Label>
              <Input
                type="date"
                value={form.date_start || ""}
                onChange={(e) => setF("date_start", e.target.value)}
                required
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs uppercase tracking-wider font-semibold">End</Label>
              <Input
                type="date"
                value={form.date_end || ""}
                onChange={(e) => setF("date_end", e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs uppercase tracking-wider font-semibold">Detail</Label>
            <Input
              value={form.detail || ""}
              onChange={(e) => setF("detail", e.target.value)}
              placeholder="Keterangan tambahan..."
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Batal
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending
                ? "Menyimpan..."
                : isEdit
                  ? "Simpan Perubahan"
                  : "Tambah"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// BulkScheduleDialog — IMPROVED: 1 activity + pilih banyak crew sekaligus
// ─────────────────────────────────────────────────────────────────────────────
function BulkScheduleDialog({
  open, onOpenChange, crews, defaultDate,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  crews: Crew[];
  defaultDate: string;
}) {
  const qc = useQueryClient();

  // Shared fields for all entries
  const [sharedType, setSharedType] = useState<string>("training");
  const [sharedActivity, setSharedActivity] = useState<string>("");
  const [sharedDateStart, setSharedDateStart] = useState<string>(defaultDate);
  const [sharedDateEnd, setSharedDateEnd] = useState<string>("");
  const [sharedDetail, setSharedDetail] = useState<string>("");

  // Selected crews
  const [selectedCrewIds, setSelectedCrewIds] = useState<Set<number>>(new Set());
  const [crewSearch, setCrewSearch] = useState<string>("");
  const [rankFilter, setRankFilter] = useState<string>("all");

  useEffect(() => {
    if (open) {
      setSharedType("training");
      setSharedActivity("");
      setSharedDateStart(defaultDate);
      setSharedDateEnd("");
      setSharedDetail("");
      setSelectedCrewIds(new Set());
      setCrewSearch("");
      setRankFilter("all");
    }
  }, [open, defaultDate]);

  const filteredCrews = crews.filter(c => {
    const matchSearch = !crewSearch ||
      c.name.toLowerCase().includes(crewSearch.toLowerCase()) ||
      c.rank.toLowerCase().includes(crewSearch.toLowerCase()) ||
      c.employee_id.toLowerCase().includes(crewSearch.toLowerCase());
    const matchRank = rankFilter === "all" || c.rank === rankFilter;
    return matchSearch && matchRank;
  });

  const toggleCrew = (id: number) => {
    setSelectedCrewIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectAll = () => setSelectedCrewIds(new Set(filteredCrews.map(c => c.id)));
  const clearAll = () => setSelectedCrewIds(new Set());

  const selectedCrews = crews.filter(c => selectedCrewIds.has(c.id));

  const mutation = useMutation({
    mutationFn: () => {
      const schedules = selectedCrews.map(crew => ({
        type: sharedType,
        activity: sharedActivity,
        date_start: sharedDateStart,
        date_end: sharedDateEnd || null,
        detail: sharedDetail || null,
        crew_id: crew.id,
        crew_name: crew.name,
        crew_role: crew.rank,
      }));
      return schedulesApi.bulk(schedules);
    },
    onSuccess: (data) => {
      toast.success(`${data.inserted?.length ?? selectedCrews.length} jadwal berhasil ditambahkan`);
      if (data.failed?.length > 0) {
        toast.warning(`${data.failed.length} jadwal gagal`);
      }
      qc.invalidateQueries({ queryKey: ["schedules"] });
      qc.invalidateQueries({ queryKey: ["schedules-summary"] });
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Bulk Tambah Jadwal</DialogTitle>
          <p className="text-sm text-muted-foreground">
            Pilih aktivitas dan beberapa crew sekaligus. Jadwal yang sama akan dibuat untuk semua crew yang dipilih.
          </p>
        </DialogHeader>

        <div className="space-y-4">
          {/* ── Shared activity info ── */}
          <Card className="p-4 space-y-3 bg-muted/30">
            <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Info Jadwal (berlaku untuk semua crew dipilih)
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs uppercase tracking-wider font-semibold">Type *</Label>
                <Select value={sharedType} onValueChange={(v) => { setSharedType(v); setSharedActivity(""); }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(TYPE_META).map(([t, m]) => (
                      <SelectItem key={t} value={t}>{m.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs uppercase tracking-wider font-semibold">
                  Activity{sharedType === "training" ? " *" : ""}
                </Label>
                {sharedType === "medex" || sharedType === "flight" ? (
                  <div className="h-9 rounded-md border border-input bg-muted/40 px-3 py-2 text-sm text-muted-foreground flex items-center">
                    {sharedType === "medex" ? "Medex — tidak perlu activity" : "Flight — tidak perlu activity"}
                  </div>
                ) : sharedType === "training" ? (
                  <TrainingActivitySelect
                    value={sharedActivity}
                    onChange={setSharedActivity}
                    selectedCrews={selectedCrews}
                    rankOverride={rankFilter !== "all" ? rankFilter : undefined}
                  />
                ) : (
                  <Input
                    value={sharedActivity}
                    onChange={(e) => setSharedActivity(e.target.value)}
                    placeholder="Keterangan aktivitas..."
                  />
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs uppercase tracking-wider font-semibold">Tanggal Mulai *</Label>
                <Input
                  type="date"
                  value={sharedDateStart}
                  onChange={(e) => setSharedDateStart(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs uppercase tracking-wider font-semibold">Tanggal Selesai</Label>
                <Input
                  type="date"
                  value={sharedDateEnd}
                  onChange={(e) => setSharedDateEnd(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs uppercase tracking-wider font-semibold">Detail</Label>
              <Input
                value={sharedDetail}
                onChange={(e) => setSharedDetail(e.target.value)}
                placeholder="Keterangan tambahan..."
              />
            </div>
          </Card>

          {/* ── Crew selection ── */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <Label className="text-xs uppercase tracking-wider font-semibold">
                Pilih Crew ({selectedCrewIds.size} dipilih)
              </Label>
              <div className="flex gap-1.5">
                <Button type="button" variant="outline" size="sm" onClick={selectAll} className="text-xs h-7">
                  Pilih Semua
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={clearAll} className="text-xs h-7">
                  Hapus Pilihan
                </Button>
              </div>
            </div>
            <div className="flex gap-2 mb-2">
              <Input
                placeholder="Cari nama crew..."
                value={crewSearch}
                onChange={(e) => setCrewSearch(e.target.value)}
                className="h-8 text-sm flex-1"
              />
              <Select value={rankFilter} onValueChange={(v) => { setRankFilter(v); setSharedActivity(""); }}>
                <SelectTrigger className="h-8 w-[130px] text-sm">
                  <SelectValue placeholder="Semua Rank" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua Rank</SelectItem>
                  {["PIC", "SIC", "FA1", "FA2", "FOO"].map(r => (
                    <SelectItem key={r} value={r}>{r}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="border rounded-lg max-h-52 overflow-y-auto divide-y divide-border">
              {filteredCrews.length === 0 && (
                <div className="p-3 text-xs text-muted-foreground text-center">Tidak ada crew ditemukan.</div>
              )}
              {filteredCrews.map(crew => (
                <div
                  key={crew.id}
                  className={`flex items-center gap-3 p-2.5 cursor-pointer hover:bg-muted/30 ${selectedCrewIds.has(crew.id) ? "bg-primary-soft/30" : ""
                    }`}
                  onClick={() => toggleCrew(crew.id)}
                >
                  <div className={`h-4 w-4 rounded border-2 flex items-center justify-center shrink-0 ${selectedCrewIds.has(crew.id)
                    ? "bg-primary border-primary text-white"
                    : "border-border"
                    }`}>
                    {selectedCrewIds.has(crew.id) && (
                      <svg viewBox="0 0 12 12" className="h-2.5 w-2.5 fill-current">
                        <path d="M10 3L5 8L2 5" stroke="white" strokeWidth="2" fill="none" strokeLinecap="round" />
                      </svg>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold truncate">{crew.name}</div>
                    <div className="text-xs text-muted-foreground">{crew.rank} · {crew.employee_id}</div>
                  </div>
                  <StatusBadge status={crew.overall_status} />
                </div>
              ))}
            </div>
          </div>

          {/* ── Selected crew preview ── */}
          {selectedCrews.length > 0 && (
            <div className="rounded-lg bg-primary-soft/20 border border-primary/20 p-3">
              <div className="text-xs font-semibold text-primary mb-1.5">
                {selectedCrews.length} crew dipilih:
              </div>
              <div className="flex flex-wrap gap-1.5">
                {selectedCrews.map(c => (
                  <span
                    key={c.id}
                    className="inline-flex items-center gap-1 text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full"
                  >
                    {c.name} ({c.rank})
                    <button
                      type="button"
                      onClick={() => toggleCrew(c.id)}
                      className="hover:text-destructive ml-0.5"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="mt-4">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Batal
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || selectedCrewIds.size === 0 || !sharedDateStart || (sharedType === "training" && !sharedActivity)}
          >
            {mutation.isPending
              ? "Menyimpan..."
              : `Tambah ${selectedCrewIds.size} Jadwal`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


// ─────────────────────────────────────────────────────────────────────────────
// TrainingActivitySelect — Pilih jenis training berdasarkan rank crew dipilih
// ─────────────────────────────────────────────────────────────────────────────
function TrainingActivitySelect({
  value, onChange, selectedCrews, rankOverride,
}: {
  value: string;
  onChange: (v: string) => void;
  selectedCrews: Crew[];
  rankOverride?: string;
}) {
  // Tentukan pilihan training berdasarkan rankOverride > selectedCrews > semua
  const { availableOptions, rankLabel } = (() => {
    // Prioritas 1: rankOverride dari filter rank
    if (rankOverride) {
      const opts = TRAINING_BY_RANK[rankOverride] || ALL_TRAINING_OPTIONS;
      return { availableOptions: opts, rankLabel: rankOverride };
    }
    // Prioritas 2: dari crew yang sudah dipilih
    if (selectedCrews.length > 0) {
      const ranks = Array.from(new Set(selectedCrews.map(c => c.rank)));
      const sets = ranks.map(r => new Set(TRAINING_BY_RANK[r] || ALL_TRAINING_OPTIONS));
      const intersection = ALL_TRAINING_OPTIONS.filter(opt => sets.every(s => s.has(opt)));
      return {
        availableOptions: intersection.length > 0 ? intersection : ALL_TRAINING_OPTIONS,
        rankLabel: ranks.join(", "),
      };
    }
    // Default: semua
    return { availableOptions: ALL_TRAINING_OPTIONS, rankLabel: null };
  })();

  return (
    <div className="space-y-1">
      {rankLabel && (
        <div className="text-[10px] text-muted-foreground">
          Menampilkan training untuk rank: <span className="font-semibold text-primary">{rankLabel}</span>
        </div>
      )}
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger>
          <SelectValue placeholder="Pilih jenis training..." />
        </SelectTrigger>
        <SelectContent>
          {availableOptions.map(opt => (
            <SelectItem key={opt} value={opt}>{opt}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}


// ─────────────────────────────────────────────────────────────────────────────
// DayDetailDialog — tampilkan semua item di hari yang diklik
// ─────────────────────────────────────────────────────────────────────────────
function DayDetailDialog({
  open, onOpenChange, items, date, isAdmin, onEdit,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  items: Schedule[];
  date: Date | null;
  isAdmin: boolean;
  onEdit: (s: Schedule) => void;
}) {
  if (!date) return null;
  const dateLabel = format(date, "EEEE, d MMMM yyyy");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <CalendarDays className="h-4 w-4 text-primary" />
            {dateLabel}
          </DialogTitle>
          <p className="text-xs text-muted-foreground">{items.length} jadwal pada hari ini</p>
        </DialogHeader>
        <div className="space-y-2 mt-1">
          {items.map((it) => {
            const m = TYPE_META[it.type] || TYPE_META.standby;
            const Icon = m.icon;
            return (
              <div
                key={it.id}
                className={`flex items-center gap-3 p-3 rounded-lg border ${isAdmin ? "cursor-pointer hover:bg-muted/30" : ""}`}
                onClick={() => isAdmin && onEdit(it)}
              >
                <div className={`h-9 w-9 rounded-lg flex items-center justify-center shrink-0 ${m.color}`}>
                  <Icon className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm truncate">
                    {it.activity || m.label}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    {it.crew_name} · {it.crew_role}
                    {it.date_end ? ` · s/d ${it.date_end}` : ""}
                  </div>
                  {it.detail && (
                    <div className="text-xs text-muted-foreground truncate">{it.detail}</div>
                  )}
                </div>
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold shrink-0 ${m.color}`}>
                  {m.label}
                </span>
              </div>
            );
          })}
        </div>
        <DialogFooter className="mt-2">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>Tutup</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    valid: "bg-success-soft text-[hsl(var(--success))]",
    warning: "bg-warning-soft text-[hsl(var(--warning))]",
    expired: "bg-destructive/10 text-destructive",
  };
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold uppercase shrink-0 ${map[status] || "bg-muted text-muted-foreground"}`}>
      {status}
    </span>
  );
}