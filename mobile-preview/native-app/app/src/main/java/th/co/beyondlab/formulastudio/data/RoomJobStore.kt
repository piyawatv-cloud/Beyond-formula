package th.co.beyondlab.formulastudio.data

import android.content.Context
import androidx.room.*
import th.co.beyondlab.formulastudio.domain.Job

@Entity(tableName = "jobs") data class JobRow(@PrimaryKey val id: String, val json: String)
@Entity(tableName = "meta") data class MetaRow(@PrimaryKey val key: String, val value: Long)

@Dao interface JobDao {
    @Query("SELECT * FROM jobs ORDER BY id") fun all(): List<JobRow>
    @Insert(onConflict = OnConflictStrategy.REPLACE) fun put(r: JobRow)
    @Query("DELETE FROM jobs WHERE id = :id") fun remove(id: String)
    @Query("SELECT value FROM meta WHERE `key` = 'counter'") fun counter(): Long?
    @Insert(onConflict = OnConflictStrategy.REPLACE) fun putMeta(m: MetaRow)
}

@Database(entities = [JobRow::class, MetaRow::class], version = 1, exportSchema = false)
abstract class FormulaDb : RoomDatabase() { abstract fun dao(): JobDao }

/**
 * Local-only Room store (SIMULATED data; this build has no INTERNET permission).
 * Main-thread queries are a deliberate shortcut for the tiny simulated data set; move to a
 * background dispatcher before any real data volume.
 */
class RoomJobStore(ctx: Context) : JobStore {
    private val dao = Room.databaseBuilder(ctx.applicationContext, FormulaDb::class.java, "formula-sim.db")
        .allowMainThreadQueries().build().dao()
    override fun loadAll(): List<Job> = dao.all().map { JobJson.fromJson(it.json) }
    override fun save(job: Job) = dao.put(JobRow(job.id, JobJson.toJson(job)))
    override fun delete(id: String) = dao.remove(id)
    override var counter: Int
        get() = (dao.counter() ?: 0L).toInt()
        set(v) = dao.putMeta(MetaRow("counter", v.toLong()))
}
