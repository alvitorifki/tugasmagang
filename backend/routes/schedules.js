const router = require('express').Router()
const db = require('../db')
const { authMiddleware, adminOnly } = require('../middleware/auth')

const VALID_TYPES = ['flight', 'training', 'off', 'standby', 'medex']
const VALID_ROLES = ['PIC', 'SIC', 'FA1', 'FA2', 'FOO']

// ── Mapping activity ke field cert di tabel crews ─────────────
// Key: activity name (uppercase), Value: field prefix di crews
const ACTIVITY_TO_CERT_FIELD = {
  'CRM': 'crm',
  'DG': 'dg',
  'PPC': 'ppc',
  'AVSEC': 'avsec',
  'MEDEX': 'medex',
  'GROUND TRAINING': 'ground_training',
  'LOFT': 'loft',
  'CET': 'cet',
  'PBN': 'pbn',
  'SMS': 'sms',
  'WS': 'ws',
  'ALAR/CFIT': 'alar_cfit',
  'ALAR_CFIT': 'alar_cfit',
  'IELP': 'ielp',
  'TCAS': 'tcas',
  'CC': 'cc',
  'FIRST AID': 'first_aid',
  'FIRST_AID': 'first_aid',
}

// Cert yang valid-nya selalu 31 Des tahun conduct
const END_OF_YEAR_CERTS = ['sms', 'dg', 'alar_cfit', 'pbn', 'avsec', 'crm', 'first_aid']

// Durasi cert dalam bulan
const CERT_DURATION = {
  medex: 6,
  ppc: 12,
  ground_training: 12,
  cet: 24,
  dg: 12,
  avsec: 12,
  ielp: 24,
  loft: 12,
  crm: 12,
  ws: 12,
  alar_cfit: 12,
  pbn: 12,
  sms: 24,
  tcas: 24,
  cc: 12,
  first_aid: 12,
}

function addMonths(dateStr, months) {
  if (!dateStr) return null
  const s = String(dateStr).trim()
  const base = /^\d{4}-\d{2}-\d{2}$/.test(s) ? s + 'T00:00:00Z' : s
  const d = new Date(base)
  if (isNaN(d.getTime())) return null
  d.setUTCMonth(d.getUTCMonth() + months)
  const year = d.getUTCFullYear()
  const month = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function endOfYearValid(dateStr) {
  if (!dateStr) return null
  const s = String(dateStr).trim()
  const base = /^\d{4}-\d{2}-\d{2}$/.test(s) ? s + 'T00:00:00Z' : s
  const d = new Date(base)
  if (isNaN(d.getTime())) return null
  return `${d.getUTCFullYear()}-12-31`
}

function calcValidDate(certField, conductDate) {
  if (!certField || !conductDate) return null
  if (END_OF_YEAR_CERTS.includes(certField)) return endOfYearValid(conductDate)
  const months = CERT_DURATION[certField] || 12
  return addMonths(conductDate, months)
}

// ── Helper validasi ───────────────────────────────────────────
function validateSchedule(body) {
  const errors = []
  if (!body.type) errors.push('type wajib diisi (flight/training/off/standby/medex)')
  if (!body.date_start) errors.push('date_start wajib diisi')
  if (!VALID_TYPES.includes(body.type)) errors.push(`type tidak valid. Pilih: ${VALID_TYPES.join(', ')}`)
  if (body.date_end && body.date_end < body.date_start)
    errors.push('date_end tidak boleh sebelum date_start')
  return errors
}

// ── Helper: auto-update medex cert jika type=medex ───────────────
async function autoUpdateMedex(crew_id, date_start) {
  if (!crew_id || !date_start) return
  try {
    const validDate = addMonths(date_start, 6)
    await db.query(`
      UPDATE crews
      SET medex_conduct = $1, medex_valid = $2, updated_at = NOW()
      WHERE id = $3
    `, [date_start, validDate, crew_id])
  } catch (e) {
    console.error('autoUpdateMedex error:', e)
  }
}


// ═══════════════════════════════════════════════════════════════
// GET /api/schedules
// ═══════════════════════════════════════════════════════════════
router.get('/', authMiddleware, async (req, res) => {
  try {
    const now = new Date()
    const year = parseInt(req.query.year) || now.getFullYear()
    const month = parseInt(req.query.month) || now.getMonth() + 1

    const startDate = `${year}-${String(month).padStart(2, '0')}-01`
    const endDate = new Date(year, month, 0).toISOString().split('T')[0]

    let sql = `
      SELECT s.*, c.name AS crew_name_ref, c.rank AS crew_rank_ref
      FROM schedules s
      LEFT JOIN crews c ON c.id = s.crew_id
      WHERE s.date_start <= $1 AND (s.date_end >= $2 OR s.date_start >= $2)
    `
    const params = [endDate, startDate]

    if (req.user.role === 'crew') {
      params.push(req.user.crew_id)
      sql += ` AND s.crew_id = $${params.length}`
    } else {
      if (req.query.crew_id) {
        params.push(req.query.crew_id)
        sql += ` AND s.crew_id = $${params.length}`
      }
      if (req.query.role) {
        params.push(req.query.role)
        sql += ` AND s.crew_role = $${params.length}`
      }
      if (req.query.type) {
        params.push(req.query.type)
        sql += ` AND s.type = $${params.length}`
      }
      if (req.query.activity) {
        params.push(`%${req.query.activity}%`)
        sql += ` AND s.activity ILIKE $${params.length}`
      }
    }

    sql += ' ORDER BY s.date_start, s.crew_name'

    const { rows } = await db.query(sql, params)
    res.json({ data: rows, meta: { year, month, start: startDate, end: endDate } })
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'Server error.' })
  }
})

// ═══════════════════════════════════════════════════════════════
// GET /api/schedules/summary
// ═══════════════════════════════════════════════════════════════
router.get('/summary', authMiddleware, adminOnly, async (req, res) => {
  try {
    const now = new Date()
    const year = parseInt(req.query.year) || now.getFullYear()
    const month = parseInt(req.query.month) || now.getMonth() + 1

    const startDate = `${year}-${String(month).padStart(2, '0')}-01`
    const endDate = new Date(year, month, 0).toISOString().split('T')[0]

    const { rows: activityRows } = await db.query(`
      SELECT activity, type, crew_role,
             COUNT(*) AS crew_count,
             array_agg(crew_name ORDER BY crew_name) AS crew_list
      FROM schedules
      WHERE date_start <= $1 AND (date_end >= $2 OR date_start >= $2)
        AND activity IS NOT NULL
      GROUP BY activity, type, crew_role
      ORDER BY activity, crew_role
    `, [endDate, startDate])

    const { rows: crewRows } = await db.query(`
      SELECT crew_id, crew_name, crew_role,
             array_agg(DISTINCT activity ORDER BY activity) AS activities,
             array_agg(DISTINCT type ORDER BY type) AS types,
             COUNT(*) AS total_events
      FROM schedules
      WHERE date_start <= $1 AND (date_end >= $2 OR date_start >= $2)
      GROUP BY crew_id, crew_name, crew_role
      ORDER BY crew_name
    `, [endDate, startDate])

    res.json({
      data: {
        by_activity: activityRows,
        crews_active: crewRows,
      },
      meta: { year, month },
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'Server error.' })
  }
})

// ═══════════════════════════════════════════════════════════════
// GET /api/schedules/activity/:activity
// ═══════════════════════════════════════════════════════════════
router.get('/activity/:activity', authMiddleware, adminOnly, async (req, res) => {
  try {
    const now = new Date()
    const year = parseInt(req.query.year) || now.getFullYear()
    const month = parseInt(req.query.month) || now.getMonth() + 1

    const startDate = `${year}-${String(month).padStart(2, '0')}-01`
    const endDate = new Date(year, month, 0).toISOString().split('T')[0]

    const { rows } = await db.query(`
      SELECT s.*, c.rank, c.employee_id, c.email, c.phone
      FROM schedules s
      LEFT JOIN crews c ON c.id = s.crew_id
      WHERE s.activity ILIKE $1
        AND s.date_start <= $2
        AND (s.date_end >= $3 OR s.date_start >= $3)
      ORDER BY s.date_start, s.crew_name
    `, [`%${req.params.activity}%`, endDate, startDate])

    res.json({ data: rows, activity: req.params.activity, meta: { year, month } })
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'Server error.' })
  }
})

// ═══════════════════════════════════════════════════════════════
// GET /api/schedules/training/list
// Ambil semua training schedule yang unik (group by activity + date)
// Digunakan untuk halaman Training Management
// ═══════════════════════════════════════════════════════════════
router.get('/training/list', authMiddleware, async (req, res) => {
  try {
    const now = new Date()
    const year = parseInt(req.query.year) || now.getFullYear()
    const month = parseInt(req.query.month) || now.getMonth() + 1

    const startDate = `${year}-${String(month).padStart(2, '0')}-01`
    const endDate = new Date(year, month, 0).toISOString().split('T')[0]

    // Query: ambil semua training schedule, group by activity + date_start
    // Sertakan instructor dari field detail jika ada
    const { rows } = await db.query(`
      SELECT
        MIN(s.id) AS id,
        s.activity,
        s.date_start,
        s.date_end,
        s.detail,
        COUNT(*) AS participant_count,
        array_agg(s.crew_name ORDER BY s.crew_name) AS participant_names,
        COALESCE(ts.status, 'planned') AS training_status,
        COALESCE(ts.instructor, s.detail) AS instructor,
        COALESCE(ts.location, '') AS location,
        COALESCE(ts.time_start, '') AS time_start,
        COALESCE(ts.time_end, '') AS time_end,
        ts.id AS training_session_id,
        ts.completed_at,
        ts.completed_by_name
      FROM schedules s
      LEFT JOIN training_sessions ts
        ON ts.activity = s.activity AND ts.date_start = s.date_start
      WHERE s.type = 'training'
        AND s.date_start <= $1
        AND (s.date_end >= $2 OR s.date_start >= $2)
      GROUP BY s.activity, s.date_start, s.date_end, s.detail,
               ts.id, ts.status, ts.instructor, ts.location,
               ts.time_start, ts.time_end, ts.completed_at, ts.completed_by_name
      ORDER BY s.date_start DESC
    `, [endDate, startDate])

    res.json({ data: rows, meta: { year, month } })
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'Server error.' })
  }
})

// ═══════════════════════════════════════════════════════════════
// GET /api/schedules/training/detail/:activity/:date
// Detail sebuah training: info + daftar peserta + status attendance
// ═══════════════════════════════════════════════════════════════
router.get('/training/detail/:activity/:date', authMiddleware, async (req, res) => {
  try {
    const { activity, date } = req.params

    // Ambil info training session jika ada
    const { rows: sessionRows } = await db.query(`
      SELECT * FROM training_sessions
      WHERE activity = $1 AND date_start = $2
      LIMIT 1
    `, [activity, date])
    const session = sessionRows[0] || null

    // Ambil daftar peserta dari schedules
    const { rows: participants } = await db.query(`
      SELECT
        s.id AS schedule_id,
        s.crew_id,
        s.crew_name,
        s.crew_role,
        s.date_start,
        s.date_end,
        c.employee_id,
        c.rank,
        COALESCE(ta.attended, true) AS attended,
        COALESCE(ta.status, 'planned') AS attendance_status
      FROM schedules s
      LEFT JOIN crews c ON c.id = s.crew_id
      LEFT JOIN training_attendance ta
        ON ta.schedule_id = s.id
      WHERE s.type = 'training'
        AND s.activity ILIKE $1
        AND s.date_start = $2
      ORDER BY s.crew_name
    `, [activity, date])

    res.json({
      data: {
        activity,
        date_start: date,
        session,
        participants,
      }
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'Server error.' })
  }
})

// ═══════════════════════════════════════════════════════════════
// POST /api/schedules/training/session
// Buat atau update training session (instructor, location, time, dll)
// ═══════════════════════════════════════════════════════════════
router.post('/training/session', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { activity, date_start, instructor, location, time_start, time_end } = req.body
    if (!activity || !date_start) {
      return res.status(400).json({ message: 'activity dan date_start wajib diisi.' })
    }

    // Upsert training_sessions
    const { rows } = await db.query(`
      INSERT INTO training_sessions (activity, date_start, instructor, location, time_start, time_end, status, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, 'planned', $7)
      ON CONFLICT (activity, date_start)
      DO UPDATE SET
        instructor = EXCLUDED.instructor,
        location = EXCLUDED.location,
        time_start = EXCLUDED.time_start,
        time_end = EXCLUDED.time_end,
        updated_at = NOW()
      RETURNING *
    `, [activity, date_start, instructor || null, location || null,
      time_start || null, time_end || null, req.user.id])

    res.json({ data: rows[0], message: 'Training session berhasil disimpan.' })
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'Server error.' })
  }
})

// ═══════════════════════════════════════════════════════════════
// POST /api/schedules/training/complete
// Complete training: update cert semua peserta yang hadir
// Body: { activity, date_start, attendances: [{schedule_id, crew_id, attended}] }
// ═══════════════════════════════════════════════════════════════
router.post('/training/complete', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { activity, date_start, attendances } = req.body

    if (!activity || !date_start) {
      return res.status(400).json({ message: 'activity dan date_start wajib diisi.' })
    }
    if (!Array.isArray(attendances) || attendances.length === 0) {
      return res.status(400).json({ message: 'attendances wajib diisi.' })
    }

    // Resolve cert field dari activity name
    const activityUpper = activity.trim().toUpperCase()
    const certField = ACTIVITY_TO_CERT_FIELD[activityUpper]

    const updatedCrew = []
    const skippedCrew = []

    // Simpan/update attendance records
    for (const att of attendances) {
      const { schedule_id, crew_id, attended } = att

      // Upsert attendance
      await db.query(`
        INSERT INTO training_attendance (schedule_id, crew_id, attended, status)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (schedule_id)
        DO UPDATE SET attended = EXCLUDED.attended, status = EXCLUDED.status, updated_at = NOW()
      `, [schedule_id, crew_id || null, attended !== false, attended !== false ? 'completed' : 'absent'])

      // Update cert hanya untuk crew yang hadir dan punya crew_id
      if (attended !== false && crew_id && certField) {
        // Ambil data crew untuk tahu rank
        const { rows: crewRows } = await db.query(
          'SELECT id, name, rank FROM crews WHERE id=$1', [crew_id]
        )
        if (!crewRows[0]) { skippedCrew.push({ crew_id, reason: 'Crew tidak ditemukan' }); continue }

        const conductDate = date_start
        const validDate = calcValidDate(certField, conductDate)

        // Update cert conduct & valid
        const { rows: updRows } = await db.query(`
          UPDATE crews
          SET ${certField}_conduct = $1, ${certField}_valid = $2, updated_at = NOW()
          WHERE id = $3
          RETURNING id, name, rank
        `, [conductDate, validDate, crew_id])

        if (updRows[0]) {
          updatedCrew.push({
            crew_id,
            name: updRows[0].name,
            cert_field: certField,
            conduct_date: conductDate,
            valid_until: validDate,
          })
        }
      } else if (!certField && attended !== false && crew_id) {
        skippedCrew.push({ crew_id, reason: `Activity "${activity}" tidak ada mapping cert field` })
      }
    }

    // Update training session status menjadi completed
    const userName = req.user.name || req.user.email || 'Admin'
    await db.query(`
      INSERT INTO training_sessions (activity, date_start, status, completed_at, completed_by, completed_by_name)
      VALUES ($1, $2, 'completed', NOW(), $3, $4)
      ON CONFLICT (activity, date_start)
      DO UPDATE SET
        status = 'completed',
        completed_at = NOW(),
        completed_by = EXCLUDED.completed_by,
        completed_by_name = EXCLUDED.completed_by_name,
        updated_at = NOW()
    `, [activity, date_start, req.user.id, userName])

    res.json({
      message: `Training selesai. ${updatedCrew.length} sertifikat crew diperbarui.`,
      cert_field: certField || null,
      updated: updatedCrew,
      skipped: skippedCrew,
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'Server error.' })
  }
})

// ═══════════════════════════════════════════════════════════════
// GET /api/schedules/:id
// ═══════════════════════════════════════════════════════════════
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT s.*, c.rank, c.employee_id
      FROM schedules s
      LEFT JOIN crews c ON c.id = s.crew_id
      WHERE s.id = $1
    `, [req.params.id])

    if (!rows[0]) return res.status(404).json({ message: 'Jadwal tidak ditemukan.' })

    if (req.user.role === 'crew' && rows[0].crew_id !== req.user.crew_id) {
      return res.status(403).json({ message: 'Akses ditolak.' })
    }

    res.json({ data: rows[0] })
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'Server error.' })
  }
})

// ═══════════════════════════════════════════════════════════════
// POST /api/schedules  (Admin)
// ═══════════════════════════════════════════════════════════════
router.post('/', authMiddleware, adminOnly, async (req, res) => {
  try {
    const b = req.body
    const errors = validateSchedule(b)
    if (errors.length) return res.status(400).json({ message: errors.join('; ') })

    let crew_name = b.crew_name || null
    let crew_role = b.crew_role || null

    if (b.crew_id) {
      const { rows: cr } = await db.query('SELECT name, rank FROM crews WHERE id=$1', [b.crew_id])
      if (cr[0]) {
        crew_name = crew_name || cr[0].name
        crew_role = crew_role || cr[0].rank
      }
    }

    const { rows } = await db.query(`
      INSERT INTO schedules
        (crew_id, crew_name, crew_role, type, activity, date_start, date_end, detail, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      RETURNING *
    `, [
      b.crew_id || null,
      crew_name,
      crew_role,
      b.type,
      b.activity || null,
      b.date_start,
      b.date_end || null,
      b.detail || null,
      req.user.id,
    ])

    // Auto-update medex cert jika type=medex
    if (b.type === 'medex' && rows[0] && rows[0].crew_id) {
      await autoUpdateMedex(rows[0].crew_id, b.date_start)
    }

    res.status(201).json({ data: rows[0], message: 'Jadwal berhasil ditambahkan.' })
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'Server error.' })
  }
})

// ═══════════════════════════════════════════════════════════════
// POST /api/schedules/bulk  (Admin)
// ═══════════════════════════════════════════════════════════════
router.post('/bulk', authMiddleware, adminOnly, async (req, res) => {
  try {
    const items = req.body.schedules
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: 'Body harus berisi array "schedules".' })
    }

    const results = []
    const failed = []

    for (const b of items) {
      const errors = validateSchedule(b)
      if (errors.length) { failed.push({ item: b, errors }); continue }

      let crew_name = b.crew_name || null
      let crew_role = b.crew_role || null
      if (b.crew_id) {
        const { rows: cr } = await db.query('SELECT name, rank FROM crews WHERE id=$1', [b.crew_id])
        if (cr[0]) { crew_name = crew_name || cr[0].name; crew_role = crew_role || cr[0].rank }
      }

      const { rows } = await db.query(`
        INSERT INTO schedules
          (crew_id, crew_name, crew_role, type, activity, date_start, date_end, detail, created_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        RETURNING *
      `, [b.crew_id || null, crew_name, crew_role, b.type, b.activity || null,
      b.date_start, b.date_end || null, b.detail || null, req.user.id])
      results.push(rows[0])
      // Auto-update medex cert jika type=medex
      if (b.type === 'medex' && rows[0] && rows[0].crew_id) {
        await autoUpdateMedex(rows[0].crew_id, b.date_start)
      }
    }

    res.status(201).json({
      message: `${results.length} jadwal berhasil ditambahkan.`,
      inserted: results,
      failed,
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'Server error.' })
  }
})

// ═══════════════════════════════════════════════════════════════
// PUT /api/schedules/:id  (Admin)
// ═══════════════════════════════════════════════════════════════
router.put('/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    const b = req.body
    const errors = validateSchedule(b)
    if (errors.length) return res.status(400).json({ message: errors.join('; ') })

    let crew_name = b.crew_name || null
    let crew_role = b.crew_role || null
    if (b.crew_id) {
      const { rows: cr } = await db.query('SELECT name, rank FROM crews WHERE id=$1', [b.crew_id])
      if (cr[0]) { crew_name = crew_name || cr[0].name; crew_role = crew_role || cr[0].rank }
    }

    const { rows } = await db.query(`
      UPDATE schedules
      SET crew_id=$1, crew_name=$2, crew_role=$3, type=$4, activity=$5,
          date_start=$6, date_end=$7, detail=$8, updated_at=NOW()
      WHERE id=$9
      RETURNING *
    `, [
      b.crew_id || null,
      crew_name,
      crew_role,
      b.type,
      b.activity || null,
      b.date_start,
      b.date_end || null,
      b.detail || null,
      req.params.id,
    ])

    if (!rows[0]) return res.status(404).json({ message: 'Jadwal tidak ditemukan.' })
    // Auto-update medex cert jika type=medex
    if (b.type === 'medex' && rows[0].crew_id) {
      await autoUpdateMedex(rows[0].crew_id, b.date_start)
    }
    res.json({ data: rows[0], message: 'Jadwal berhasil diupdate.' })
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'Server error.' })
  }
})

// ═══════════════════════════════════════════════════════════════
// DELETE /api/schedules/:id  (Admin)
// ═══════════════════════════════════════════════════════════════
router.delete('/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { rowCount } = await db.query('DELETE FROM schedules WHERE id=$1', [req.params.id])
    if (!rowCount) return res.status(404).json({ message: 'Jadwal tidak ditemukan.' })
    res.json({ message: 'Jadwal berhasil dihapus.' })
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'Server error.' })
  }
})

module.exports = router