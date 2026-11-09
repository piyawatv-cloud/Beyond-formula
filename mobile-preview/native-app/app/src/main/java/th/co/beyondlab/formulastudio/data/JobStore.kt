package th.co.beyondlab.formulastudio.data

import th.co.beyondlab.formulastudio.domain.Job

/** Persistence port. The job-number counter lives here so it survives restarts and deletes. */
interface JobStore {
    fun loadAll(): List<Job>
    fun save(job: Job)
    fun delete(id: String)
    var counter: Int
}

class InMemoryJobStore : JobStore {
    private val m = LinkedHashMap<String, Job>()
    override fun loadAll() = m.values.toList()
    override fun save(job: Job) { m[job.id] = job }
    override fun delete(id: String) { m.remove(id) }
    override var counter: Int = 0
}
