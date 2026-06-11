require('dotenv').config()
const db = require('./index')

async function fixFA2() {
    console.log('🔧 Starting FA → FA2 migration...')

    // Step 1: Drop constraint lama dulu
    await db.query(`ALTER TABLE crews DROP CONSTRAINT IF EXISTS crews_rank_check`)
    console.log('✅ Dropped old rank constraint')

    // Step 2: Update data DULU sebelum pasang constraint baru
    const { rowCount: crewsUpdated } = await db.query(
        `UPDATE crews SET rank = 'FA2' WHERE rank = 'FA'`
    )
    console.log(`✅ Updated ${crewsUpdated} crew(s): FA → FA2`)

    const { rowCount: schedulesUpdated } = await db.query(
        `UPDATE schedules SET crew_role = 'FA2' WHERE crew_role = 'FA'`
    )
    console.log(`✅ Updated ${schedulesUpdated} schedule(s): crew_role FA → FA2`)

    // Step 3: Baru pasang constraint baru setelah data bersih
    await db.query(`
    ALTER TABLE crews ADD CONSTRAINT crews_rank_check
      CHECK (rank IN ('PIC','SIC','FA1','FA2','FOO'))
  `)
    console.log('✅ Added new rank constraint (includes FA2)')

    console.log('\n🎉 Migration complete! FA2 is now active.')
    process.exit(0)
}

fixFA2().catch(err => {
    console.error('❌ Migration failed:', err.message)
    process.exit(1)
})