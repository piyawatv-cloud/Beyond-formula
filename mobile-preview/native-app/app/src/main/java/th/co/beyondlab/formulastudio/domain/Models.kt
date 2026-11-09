package th.co.beyondlab.formulastudio.domain

data class ChatMessage(val id: String, val user: String, val text: String, val ts: Long)

/**
 * Brief fields. Names are IDENTICAL to the locked web record fields (CLAUDE.md rule 2); a future
 * serializer must flatten these to the record's top level. All optional; values stay Strings like
 * the web form inputs. allBenefits / allSP / finalTarget are derived exactly like the web's generateDash.
 */
data class Brief(
    val brand: String = "",
    val customer: String = "",
    val salesOwner: String = "",
    val phone: String = "",
    val form: String = "",
    val size: String = "",
    val sizeUnit: String = "",
    val uw: String = "",
    val uwUnit: String = "mg",
    val gender: String = "",
    val price: String = "",
    val notes: String = "",
    val cat: String = "",
    val subcat: String = "",
    val priority: String = "medium",
    val fdaType: String = "",
    val color: String = "",
    val scent: String = "",
    val flavor: String = "",
    val packType: String = "",
    val widthCm: String = "",
    val lengthCm: String = "",
    val allConcepts: List<String> = emptyList(),
    val finalTarget: String = "",
    /** Derived on save from the concept KB (web generateDash); empty until the repository derives them. */
    val allBenefits: List<String> = emptyList(),
    val allSP: List<String> = emptyList(),
    /** Constraints. On save the web stores allCons here (defaults when none were typed). */
    val cons: List<String> = emptyList(),
    /** Derived by the web as allBenefits.slice(0,6); the web re-loads its claims field from this on edit. */
    val benefits: List<String> = emptyList(),
) {
    /** Same as web: concepts joined by ' + ', or 'Health Supplement'. */
    val conceptStr: String get() = allConcepts.joinToString(" + ").ifEmpty { "Health Supplement" }
}

/** Saved row = web rows[] {num,name,w,o,p,actual,note,hero,fda}. */
data class Ingredient(
    val num: Int, val name: String, val w: Double, val o: String,
    val p: Double, val actual: Double, val note: String, val hero: Boolean,
    /** FDA check result; null when reference data was not available. */
    val fda: FdaResult? = null,
)

/** Raw text from the form; parsed by [IngredientMath.build]. */
data class IngredientInput(
    val name: String = "", val w: String = "", val o: String = "",
    val p: String = "", val note: String = "", val hero: Boolean = false,
)

data class Job(
    /** Job number A00001 — never reused, never decreased (owner decision 2026-11-01). */
    val id: String,
    val brief: Brief,
    val rows: List<Ingredient> = emptyList(),
    val approvals: Map<String, Boolean> = emptyMap(),
    val messages: List<ChatMessage> = emptyList(),
    val closed: Boolean = false,
) {
    val totW: Double get() = rows.sumOf { it.w }
    val totA: Double get() = rows.sumOf { it.actual }
}

class PermissionDenied(message: String) : Exception(message)
