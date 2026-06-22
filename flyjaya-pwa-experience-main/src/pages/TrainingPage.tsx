import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { trainingApi, TrainingSession, TrainingDetail, TrainingParticipant } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { AppLayout } from "@/components/AppLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
    ChevronLeft, ChevronRight, GraduationCap, Users, CheckCircle2,
    CalendarDays, Clock, MapPin, User, Eye, CheckCheck, XCircle, Download, FileDown,
} from "lucide-react";
import { toast } from "sonner";
import { format, addMonths, parseISO } from "date-fns";

// ── CERT mapping display ─────────────────────────────────────
const CERT_FIELD_LABEL: Record<string, string> = {
    crm: "CRM", dg: "DG", ppc: "PPC", avsec: "AVSEC", medex: "MEDEX",
    ground_training: "Ground Training", loft: "LOFT", cet: "CET", pbn: "PBN",
    sms: "SMS", ws: "WS", alar_cfit: "ALAR/CFIT", ielp: "IELP", tcas: "TCAS",
    cc: "CC", first_aid: "First Aid",
};

const ACTIVITY_TO_CERT: Record<string, string> = {
    "CRM": "crm", "DG": "dg", "PPC": "ppc", "AVSEC": "avsec", "MEDEX": "medex",
    "GROUND TRAINING": "ground_training", "LOFT": "loft", "CET": "cet",
    "PBN": "pbn", "SMS": "sms", "WS": "ws", "ALAR/CFIT": "alar_cfit",
    "IELP": "ielp", "TCAS": "tcas", "CC": "cc", "FIRST AID": "first_aid",
};

function toDateInput(val: string | null | undefined): string {
    if (!val) return "";
    if (/^\d{4}-\d{2}-\d{2}$/.test(val)) return val;
    if (val.includes("T") || val.includes("Z")) {
        const d = new Date(val);
        if (!isNaN(d.getTime())) {
            return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
        }
    }
    return "";
}

function formatDate(val: string | null | undefined): string {
    if (!val) return "—";
    const d = toDateInput(val);
    if (!d) return val as string;
    try {
        const [y, m, day] = d.split("-");
        const months = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
        return `${parseInt(day)} ${months[parseInt(m) - 1]} ${y}`;
    } catch { return d; }
}

function StatusBadge({ status }: { status: string }) {
    const map: Record<string, { label: string; cls: string }> = {
        planned: { label: "Planned", cls: "bg-blue-100 text-blue-700 border-blue-200" },
        completed: { label: "Completed", cls: "bg-green-100 text-green-700 border-green-200" },
        cancelled: { label: "Cancelled", cls: "bg-red-100 text-red-700 border-red-200" },
    };
    const s = map[status] || { label: status, cls: "bg-muted text-muted-foreground" };
    return (
        <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${s.cls}`}>
            {s.label}
        </span>
    );
}

// ─────────────────────────────────────────────────────────────
export default function TrainingPage() {
    const { user } = useAuth();
    const isAdmin = user?.role === "admin";
    const qc = useQueryClient();

    const [cursor, setCursor] = useState<Date>(new Date());
    const [detailOpen, setDetailOpen] = useState(false);
    const [selectedTraining, setSelectedTraining] = useState<TrainingSession | null>(null);
    const [pdfLoading, setPdfLoading] = useState(false);

    const year = cursor.getFullYear();
    const month = cursor.getMonth() + 1;

    const { data, isLoading } = useQuery({
        queryKey: ["training-list", year, month],
        queryFn: () => trainingApi.list(year, month),
    });

    const trainings = data?.data ?? [];

    const openDetail = (t: TrainingSession) => {
        setSelectedTraining(t);
        setDetailOpen(true);
    };

    // ── PDF helpers ──────────────────────────────────────────
    const MONTHS_ID = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

    function buildPdfHtml(title: string, sessions: TrainingSession[]): string {
        const now = new Date();
        const generatedAt = `${now.getDate()} ${MONTHS_ID[now.getMonth()]} ${now.getFullYear()}, ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

        const rows = sessions.map((t, i) => {
            const certField = ACTIVITY_TO_CERT[t.activity?.toUpperCase() ?? ""] || null;
            const certLabel = certField ? CERT_FIELD_LABEL[certField] : "—";
            const statusLabel = t.status === "completed" ? "Selesai" : t.status === "cancelled" ? "Dibatalkan" : "Planned";
            const statusColor = t.status === "completed" ? "#16a34a" : t.status === "cancelled" ? "#dc2626" : "#2563eb";
            const dateStr = formatDate(t.date_start);
            const dateEnd = t.date_end ? ` s/d ${formatDate(t.date_end)}` : "";
            return `<tr>
                <td>${i + 1}</td>
                <td><strong>${t.activity || "—"}</strong></td>
                <td>${dateStr}${dateEnd}</td>
                <td>${t.instructor || "—"}</td>
                <td>${t.location || "—"}</td>
                <td>${t.time_start ? `${t.time_start}${t.time_end ? " – " + t.time_end : ""}` : "—"}</td>
                <td>${t.participant_count ?? 0}</td>
                <td>${certLabel}</td>
                <td style="color:${statusColor};font-weight:600">${statusLabel}</td>
                ${t.completed_by_name ? `<td>${t.completed_by_name}</td>` : "<td>—</td>"}
            </tr>`;
        }).join("");

        return `<!DOCTYPE html><html><head>
        <meta charset="UTF-8"><title>${title}</title>
        <style>
            body { font-family: Arial, sans-serif; padding: 24px; font-size: 11px; color: #1a1a1a; }
            .header { display: flex; align-items: center; gap: 12px; margin-bottom: 4px; }
            .logo-text { font-size: 20px; font-weight: 900; color: #1e40af; letter-spacing: -0.5px; }
            h2 { font-size: 15px; color: #1e40af; margin: 8px 0 2px; }
            .meta { color: #666; margin-bottom: 16px; font-size: 10px; }
            .summary { display: flex; gap: 16px; margin-bottom: 14px; }
            .summary-card { background: #f0f4ff; border: 1px solid #c7d7fc; border-radius: 6px; padding: 8px 14px; min-width: 90px; }
            .summary-card .num { font-size: 18px; font-weight: 800; color: #1e40af; }
            .summary-card .lbl { font-size: 9px; color: #666; text-transform: uppercase; letter-spacing: 0.5px; }
            table { border-collapse: collapse; width: 100%; margin-top: 8px; }
            th { background: #1e40af; color: white; padding: 6px 7px; text-align: left; font-size: 10px; white-space: nowrap; }
            td { border: 1px solid #ddd; padding: 5px 7px; vertical-align: top; }
            tr:nth-child(even) td { background: #f8faff; }
            tr:hover td { background: #eef2ff; }
            .footer { margin-top: 20px; font-size: 9px; color: #999; border-top: 1px solid #eee; padding-top: 8px; }
            @media print { body { padding: 10px; } }
        </style></head><body>
        <div class="header">
            <div class="logo-text">✈ FlyJaya</div>
        </div>
        <h2>Laporan Training — ${title}</h2>
        <div class="meta">Digenerate: ${generatedAt} | Total: ${sessions.length} training</div>
        <div class="summary">
            <div class="summary-card"><div class="num">${sessions.length}</div><div class="lbl">Total Training</div></div>
            <div class="summary-card"><div class="num">${sessions.filter(t => t.status === "completed").length}</div><div class="lbl">Selesai</div></div>
            <div class="summary-card"><div class="num">${sessions.filter(t => t.status !== "completed" && t.status !== "cancelled").length}</div><div class="lbl">Planned</div></div>
            <div class="summary-card"><div class="num">${sessions.reduce((s, t) => s + (parseInt(String(t.participant_count ?? 0)) || 0), 0)}</div><div class="lbl">Total Peserta</div></div>
        </div>
        <table>
            <thead><tr>
                <th>No</th><th>Aktivitas</th><th>Tanggal</th><th>Instruktur</th>
                <th>Lokasi</th><th>Waktu</th><th>Peserta</th><th>Cert</th>
                <th>Status</th><th>Diselesaikan Oleh</th>
            </tr></thead>
            <tbody>${rows || "<tr><td colspan='10' style='text-align:center;color:#999'>Tidak ada data training</td></tr>"}</tbody>
        </table>
        <div class="footer">FlyJaya Training Management System · Dicetak otomatis</div>
        </body></html>`;
    }

    function printHtml(html: string) {
        const win = window.open("", "_blank", "width=1100,height=750");
        if (!win) { toast.error("Popup diblokir. Izinkan popup lalu coba lagi."); return; }
        win.document.write(html);
        win.document.close();
        win.focus();
        setTimeout(() => win.print(), 600);
    }

    const handlePdfBulanIni = () => {
        const title = format(cursor, "MMMM yyyy");
        const html = buildPdfHtml(title, trainings);
        printHtml(html);
    };

    const handlePdfSemuaBulan = async () => {
        setPdfLoading(true);
        try {
            const promises = Array.from({ length: 12 }, (_, i) =>
                trainingApi.list(year, i + 1).then(r => r.data ?? [])
            );
            const allData = await Promise.all(promises);
            const allTrainings = allData.flat().sort((a, b) =>
                (a.date_start || "").localeCompare(b.date_start || "")
            );
            const html = buildPdfHtml(`Semua Bulan — ${year}`, allTrainings);
            printHtml(html);
        } catch (e: any) {
            toast.error("Gagal memuat data: " + e.message);
        } finally {
            setPdfLoading(false);
        }
    };

    return (
        <AppLayout>
            {/* ── Header ── */}
            <div className="flex flex-col md:flex-row md:items-end gap-4 md:justify-between">
                <div>
                    <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
                        Schedule / Training
                    </div>
                    <h1 className="text-2xl md:text-3xl font-extrabold mt-1 flex items-center gap-2">
                        <GraduationCap className="h-7 w-7 text-primary" />
                        Training Management
                    </h1>
                    <p className="text-sm text-muted-foreground mt-1">
                        Monitor & selesaikan training crew — sertifikat otomatis ter-update.
                    </p>
                </div>
                <div className="flex gap-2 items-center flex-wrap">
                    <Button size="icon" variant="outline" onClick={() => setCursor(addMonths(cursor, -1))}>
                        <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <Button variant="secondary" onClick={() => setCursor(new Date())} className="font-semibold">
                        Bulan Ini
                    </Button>
                    <Button size="icon" variant="outline" onClick={() => setCursor(addMonths(cursor, 1))}>
                        <ChevronRight className="h-4 w-4" />
                    </Button>
                    <span className="text-sm font-semibold text-muted-foreground">
                        {format(cursor, "MMMM yyyy")}
                    </span>
                    <div className="h-5 w-px bg-border" />
                    <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5"
                        onClick={handlePdfBulanIni}
                        disabled={pdfLoading || trainings.length === 0}
                        title="Export PDF bulan ini"
                    >
                        <Download className="h-4 w-4" />
                        PDF Bulan Ini
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5"
                        onClick={handlePdfSemuaBulan}
                        disabled={pdfLoading}
                        title="Export PDF semua bulan tahun ini"
                    >
                        <FileDown className="h-4 w-4" />
                        {pdfLoading ? "Memuat..." : `PDF ${year}`}
                    </Button>
                </div>
            </div>
            {/* ── Training List ── */}
            <div className="mt-5 space-y-3">
                {isLoading && (
                    <Card className="p-8 text-center text-muted-foreground">Memuat data training...</Card>
                )}
                {!isLoading && trainings.length === 0 && (
                    <Card className="p-10 text-center">
                        <GraduationCap className="h-10 w-10 mx-auto text-muted-foreground/40 mb-3" />
                        <p className="text-muted-foreground text-sm">
                            Tidak ada training di {format(cursor, "MMMM yyyy")}.
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                            Tambahkan jadwal training di menu Schedule (type = Training).
                        </p>
                    </Card>
                )}
                {trainings.map((t) => {
                    const certField = ACTIVITY_TO_CERT[t.activity?.toUpperCase() ?? ""] || null;
                    const certLabel = certField ? CERT_FIELD_LABEL[certField] : null;
                    const isCompleted = t.status === "completed";

                    return (
                        <Card
                            key={`${t.activity}-${t.date_start}`}
                            className={`p-0 overflow-hidden border-l-4 ${isCompleted ? "border-l-green-500" : "border-l-blue-400"
                                }`}
                        >
                            <div className="p-4 flex flex-col md:flex-row md:items-center gap-3">
                                {/* Icon */}
                                <div className={`h-12 w-12 rounded-xl flex items-center justify-center shrink-0 ${isCompleted ? "bg-green-100" : "bg-blue-100"
                                    }`}>
                                    {isCompleted
                                        ? <CheckCheck className="h-6 w-6 text-green-600" />
                                        : <GraduationCap className="h-6 w-6 text-blue-600" />
                                    }
                                </div>

                                {/* Info utama */}
                                <div className="flex-1 min-w-0">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className="font-bold text-base">{t.activity || "—"}</span>
                                        <StatusBadge status={t.status || "planned"} />
                                        {certLabel && (
                                            <span className="text-[11px] bg-amber-100 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full font-semibold">
                                                Cert: {certLabel}
                                            </span>
                                        )}
                                    </div>
                                    <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1.5 text-sm text-muted-foreground">
                                        <span className="flex items-center gap-1">
                                            <CalendarDays className="h-3.5 w-3.5" />
                                            {formatDate(t.date_start)}
                                        </span>
                                        {t.instructor && (
                                            <span className="flex items-center gap-1">
                                                <User className="h-3.5 w-3.5" />
                                                {t.instructor}
                                            </span>
                                        )}
                                        {t.location && (
                                            <span className="flex items-center gap-1">
                                                <MapPin className="h-3.5 w-3.5" />
                                                {t.location}
                                            </span>
                                        )}
                                        {(t.time_start || t.time_end) && (
                                            <span className="flex items-center gap-1">
                                                <Clock className="h-3.5 w-3.5" />
                                                {t.time_start}{t.time_end ? ` – ${t.time_end}` : ""}
                                            </span>
                                        )}
                                        <span className="flex items-center gap-1">
                                            <Users className="h-3.5 w-3.5" />
                                            {t.participant_count} Crew
                                        </span>
                                    </div>
                                    {isCompleted && t.completed_by_name && (
                                        <div className="mt-1 text-xs text-green-700 font-medium">
                                            ✓ Diselesaikan oleh {t.completed_by_name}
                                        </div>
                                    )}
                                </div>

                                {/* Actions */}
                                <div className="flex gap-2 shrink-0">
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => openDetail(t)}
                                        className="gap-1.5"
                                    >
                                        <Eye className="h-4 w-4" />
                                        Detail
                                    </Button>
                                </div>
                            </div>
                        </Card>
                    );
                })}
            </div>

            {/* ── Training Detail Dialog ── */}
            {selectedTraining && (
                <TrainingDetailDialog
                    open={detailOpen}
                    onOpenChange={(v) => { setDetailOpen(v); if (!v) setSelectedTraining(null); }}
                    training={selectedTraining}
                    isAdmin={isAdmin}
                    onCompleted={() => {
                        qc.invalidateQueries({ queryKey: ["training-list"] });
                        setDetailOpen(false);
                        setSelectedTraining(null);
                    }}
                />
            )}
        </AppLayout>
    );
}

// ─────────────────────────────────────────────────────────────
// Training Detail Dialog
// ─────────────────────────────────────────────────────────────
function TrainingDetailDialog({
    open, onOpenChange, training, isAdmin, onCompleted,
}: {
    open: boolean;
    onOpenChange: (v: boolean) => void;
    training: TrainingSession;
    isAdmin: boolean;
    onCompleted: () => void;
}) {
    const [completeOpen, setCompleteOpen] = useState(false);

    const { data, isLoading } = useQuery({
        queryKey: ["training-detail", training.activity, training.date_start],
        queryFn: () => trainingApi.detail(training.activity, toDateInput(training.date_start)!),
        enabled: open,
    });

    const detail: TrainingDetail | null = data?.data ?? null;
    const isCompleted = (detail?.session?.status || training.status) === "completed";

    const certField = ACTIVITY_TO_CERT[training.activity?.toUpperCase() ?? ""] || null;
    const certLabel = certField ? CERT_FIELD_LABEL[certField] : null;

    return (
        <>
            <Dialog open={open} onOpenChange={onOpenChange}>
                <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <GraduationCap className="h-5 w-5 text-primary" />
                            {training.activity}
                            <StatusBadge status={detail?.session?.status || training.status || "planned"} />
                        </DialogTitle>
                    </DialogHeader>

                    {/* ── Info training ── */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 bg-muted/30 rounded-xl p-4">
                        <InfoBlock label="Tanggal" value={formatDate(training.date_start)} icon={<CalendarDays className="h-4 w-4" />} />
                        <InfoBlock
                            label="Instructor"
                            value={detail?.session?.instructor || training.instructor || "—"}
                            icon={<User className="h-4 w-4" />}
                        />
                        <InfoBlock
                            label="Lokasi"
                            value={detail?.session?.location || training.location || "—"}
                            icon={<MapPin className="h-4 w-4" />}
                        />
                        <InfoBlock
                            label="Waktu"
                            value={
                                detail?.session?.time_start || training.time_start
                                    ? `${detail?.session?.time_start || training.time_start} – ${detail?.session?.time_end || training.time_end || ""}`
                                    : "—"
                            }
                            icon={<Clock className="h-4 w-4" />}
                        />
                    </div>

                    {certLabel && (
                        <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-2.5 text-sm text-amber-800 flex items-center gap-2">
                            <CheckCircle2 className="h-4 w-4 text-amber-500 shrink-0" />
                            <span>
                                Setelah Complete Training, sertifikat <b>{certLabel}</b> semua peserta yang hadir
                                akan diperbarui secara otomatis.
                            </span>
                        </div>
                    )}

                    {/* ── Peserta ── */}
                    <div>
                        <div className="flex items-center justify-between mb-2">
                            <h3 className="font-bold flex items-center gap-1.5 text-sm">
                                <Users className="h-4 w-4" />
                                Peserta ({detail?.participants?.length ?? 0} Crew)
                            </h3>
                            <span className="text-xs text-muted-foreground">
                                Data otomatis dari Schedule
                            </span>
                        </div>

                        {isLoading && (
                            <div className="py-6 text-center text-muted-foreground text-sm">
                                Memuat data peserta...
                            </div>
                        )}

                        {!isLoading && (
                            <div className="border rounded-lg divide-y divide-border overflow-hidden">
                                {/* Header */}
                                <div className="grid grid-cols-12 bg-muted/40 px-3 py-2 text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
                                    <span className="col-span-1">No</span>
                                    <span className="col-span-4">Nama</span>
                                    <span className="col-span-2">Rank</span>
                                    <span className="col-span-3">Employee ID</span>
                                    <span className="col-span-2 text-center">Kehadiran</span>
                                </div>

                                {detail?.participants?.map((p, i) => (
                                    <div key={p.schedule_id} className="grid grid-cols-12 px-3 py-2.5 items-center text-sm hover:bg-muted/10">
                                        <span className="col-span-1 text-muted-foreground">{i + 1}</span>
                                        <span className="col-span-4 font-medium truncate">{p.crew_name}</span>
                                        <span className="col-span-2 text-muted-foreground">{p.crew_role || p.rank || "—"}</span>
                                        <span className="col-span-3 text-muted-foreground text-xs font-mono">{p.employee_id || "—"}</span>
                                        <div className="col-span-2 flex justify-center">
                                            {isCompleted ? (
                                                <AttendanceBadge attended={p.attended} status={p.attendance_status} />
                                            ) : (
                                                <span className="text-[11px] bg-blue-50 text-blue-600 border border-blue-200 px-2 py-0.5 rounded-full font-semibold">
                                                    Planned
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                ))}

                                {(!detail?.participants || detail.participants.length === 0) && (
                                    <div className="py-6 text-center text-muted-foreground text-sm">
                                        Tidak ada peserta ditemukan.
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    <DialogFooter className="gap-2">
                        <Button variant="ghost" onClick={() => onOpenChange(false)}>
                            Tutup
                        </Button>
                        {isAdmin && !isCompleted && detail && detail.participants.length > 0 && (
                            <Button
                                onClick={() => setCompleteOpen(true)}
                                className="bg-green-600 hover:bg-green-700 text-white gap-2"
                            >
                                <CheckCheck className="h-4 w-4" />
                                Complete Training
                            </Button>
                        )}
                        {isCompleted && (
                            <div className="flex items-center gap-1.5 text-green-700 text-sm font-semibold">
                                <CheckCircle2 className="h-4 w-4" />
                                Training telah diselesaikan
                            </div>
                        )}
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* ── Complete Training Dialog ── */}
            {detail && (
                <CompleteTrainingDialog
                    open={completeOpen}
                    onOpenChange={setCompleteOpen}
                    training={training}
                    detail={detail}
                    certLabel={certLabel}
                    onSuccess={() => {
                        setCompleteOpen(false);
                        onCompleted();
                        toast.success("Training selesai! Sertifikat crew telah diperbarui otomatis.");
                    }}
                />
            )}
        </>
    );
}

// ─────────────────────────────────────────────────────────────
// Complete Training Dialog — checklist kehadiran + konfirmasi
// ─────────────────────────────────────────────────────────────
function CompleteTrainingDialog({
    open, onOpenChange, training, detail, certLabel, onSuccess,
}: {
    open: boolean;
    onOpenChange: (v: boolean) => void;
    training: TrainingSession;
    detail: TrainingDetail;
    certLabel: string | null;
    onSuccess: () => void;
}) {
    const qc = useQueryClient();

    // State attendance: default semua hadir
    const [attendances, setAttendances] = useState<Record<number, boolean>>(() => {
        const init: Record<number, boolean> = {};
        detail.participants.forEach(p => { init[p.schedule_id] = true; });
        return init;
    });

    const toggleAttendance = (scheduleId: number) => {
        setAttendances(prev => ({ ...prev, [scheduleId]: !prev[scheduleId] }));
    };

    const attendingCount = Object.values(attendances).filter(Boolean).length;

    const mutation = useMutation({
        mutationFn: () => trainingApi.complete({
            activity: training.activity,
            date_start: toDateInput(training.date_start)!,
            attendances: detail.participants.map(p => ({
                schedule_id: p.schedule_id,
                crew_id: p.crew_id,
                attended: attendances[p.schedule_id] ?? true,
            })),
        }),
        onSuccess: (res) => {
            qc.invalidateQueries({ queryKey: ["training-list"] });
            qc.invalidateQueries({ queryKey: ["training-detail"] });
            qc.invalidateQueries({ queryKey: ["crews"] });
            onSuccess();
        },
        onError: (e: any) => toast.error(e.message),
    });

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <CheckCheck className="h-5 w-5 text-green-600" />
                        Complete Training
                    </DialogTitle>
                </DialogHeader>

                {/* Info summary */}
                <div className="rounded-lg border bg-muted/30 p-4 space-y-1.5 text-sm">
                    <div className="flex justify-between">
                        <span className="text-muted-foreground">Activity</span>
                        <span className="font-semibold">{training.activity}</span>
                    </div>
                    <div className="flex justify-between">
                        <span className="text-muted-foreground">Tanggal</span>
                        <span className="font-semibold">{formatDate(training.date_start)}</span>
                    </div>
                    {detail.session?.instructor && (
                        <div className="flex justify-between">
                            <span className="text-muted-foreground">Instructor</span>
                            <span className="font-semibold">{detail.session.instructor}</span>
                        </div>
                    )}
                    <div className="flex justify-between">
                        <span className="text-muted-foreground">Total Peserta</span>
                        <span className="font-semibold">{detail.participants.length} Crew</span>
                    </div>
                </div>

                {/* Cert update info */}
                {certLabel && (
                    <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800">
                        <div className="font-semibold mb-1">Dengan menyelesaikan training ini, sistem akan:</div>
                        <ul className="space-y-1 text-xs">
                            <li className="flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 text-amber-500" /> Update conduct date sertifikat <b>{certLabel}</b> sesuai tanggal training</li>
                            <li className="flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 text-amber-500" /> Update valid until date sesuai aturan masa berlaku</li>
                            <li className="flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 text-amber-500" /> Update status sertifikat (Valid / Warning / Expired)</li>
                            <li className="flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 text-amber-500" /> Menyimpan histori training</li>
                        </ul>
                    </div>
                )}

                {/* Attendance checklist */}
                <div>
                    <div className="flex items-center justify-between mb-2">
                        <Label className="text-xs uppercase tracking-wider font-semibold text-muted-foreground">
                            Checklist Kehadiran
                        </Label>
                        <span className="text-xs text-muted-foreground">
                            {attendingCount} / {detail.participants.length} Hadir
                        </span>
                    </div>
                    <div className="flex gap-2 mb-2">
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <span className="inline-block w-3 h-3 rounded border-2 border-primary bg-primary" />
                            Hadir
                        </span>
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <span className="inline-block w-3 h-3 rounded border-2 border-border" />
                            Tidak Hadir
                        </span>
                    </div>
                    <div className="border rounded-lg divide-y divide-border max-h-56 overflow-y-auto">
                        {detail.participants.map((p, i) => (
                            <div
                                key={p.schedule_id}
                                className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-muted/20 ${attendances[p.schedule_id] ? "bg-green-50/50" : "bg-red-50/30"
                                    }`}
                                onClick={() => toggleAttendance(p.schedule_id)}
                            >
                                <div className={`h-5 w-5 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${attendances[p.schedule_id]
                                    ? "bg-primary border-primary text-white"
                                    : "border-border"
                                    }`}>
                                    {attendances[p.schedule_id] && (
                                        <svg viewBox="0 0 12 12" className="h-3 w-3 fill-current">
                                            <path d="M10 3L5 8L2 5" stroke="white" strokeWidth="2" fill="none" strokeLinecap="round" />
                                        </svg>
                                    )}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="text-sm font-medium truncate">{p.crew_name}</div>
                                    <div className="text-xs text-muted-foreground">{p.crew_role || p.rank} · {p.employee_id || "—"}</div>
                                </div>
                                {attendances[p.schedule_id]
                                    ? <span className="text-xs text-green-600 font-semibold shrink-0">Hadir</span>
                                    : <span className="text-xs text-red-500 font-semibold shrink-0">Tidak Hadir</span>
                                }
                            </div>
                        ))}
                    </div>
                </div>

                <DialogFooter className="gap-2">
                    <Button variant="ghost" onClick={() => onOpenChange(false)}>
                        Batal
                    </Button>
                    <Button
                        onClick={() => mutation.mutate()}
                        disabled={mutation.isPending}
                        className="bg-green-600 hover:bg-green-700 text-white gap-2"
                    >
                        <CheckCheck className="h-4 w-4" />
                        {mutation.isPending ? "Memproses..." : `Complete Training (${attendingCount} Crew)`}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

// ── Sub-komponen kecil ────────────────────────────────────────
function InfoBlock({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
    return (
        <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold flex items-center gap-1">
                {icon}{label}
            </div>
            <div className="mt-0.5 text-sm font-semibold truncate">{value}</div>
        </div>
    );
}

function AttendanceBadge({ attended, status }: { attended: boolean; status: string }) {
    if (attended) {
        return (
            <span className="text-[11px] bg-green-50 text-green-700 border border-green-200 px-2 py-0.5 rounded-full font-semibold flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3" />Hadir
            </span>
        );
    }
    return (
        <span className="text-[11px] bg-red-50 text-red-600 border border-red-200 px-2 py-0.5 rounded-full font-semibold flex items-center gap-1">
            <XCircle className="h-3 w-3" />Absen
        </span>
    );
}