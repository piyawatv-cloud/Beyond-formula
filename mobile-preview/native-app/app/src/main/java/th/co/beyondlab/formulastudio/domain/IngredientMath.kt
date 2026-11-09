package th.co.beyondlab.formulastudio.domain

/** Mirrors the web's getRows()/calcRow(): actual = w * p / 100. */
object IngredientMath {
    fun actual(w: Double, p: Double) = w * p / 100

    /** Live preview text for one row, like the web's "actual" cell ('—' when w <= 0). */
    fun preview(w: String, p: String): String {
        val wv = w.trim().toDoubleOrNull()?.takeIf { it.isFinite() } ?: 0.0
        val pv = p.trim().toDoubleOrNull()?.takeIf { it.isFinite() } ?: 0.0
        return if (wv > 0) Fmt.f2(actual(wv, pv)) + " mg" else "—"
    }

    /**
     * Rows without a name are dropped (web). Blank weight = 0; blank/0 purity = 100 (web uses
     * `parseFloat(x)||100`). Origin blank = '—'. Anything non-numeric, negative or non-finite is
     * rejected instead of silently becoming 0/null.
     */
    fun build(inputs: List<IngredientInput>, web: WebData? = null): List<Ingredient> {
        val out = ArrayList<Ingredient>()
        inputs.forEach { r ->
            val name = r.name.trim()
            if (name.isEmpty()) return@forEach
            val w = num(r.w, "น้ำหนักของ $name")
            val pRaw = num(r.p, "ความบริสุทธิ์ของ $name")
            val p = if (pRaw == 0.0) 100.0 else pRaw
            out += Ingredient(out.size + 1, name, w, r.o.ifBlank { "—" }, p, actual(w, p), r.note, r.hero,
                web?.checkFda(name, actual(w, p)))
        }
        return out
    }

    fun toInputs(rows: List<Ingredient>): List<IngredientInput> = rows.map {
        IngredientInput(it.name, fmt(it.w), if (it.o == "—") "" else it.o, fmt(it.p), it.note, it.hero)
    }

    private fun fmt(d: Double) = if (d == Math.floor(d) && d < 1e15) d.toLong().toString() else d.toString()

    private fun num(s: String, what: String): Double {
        if (s.isBlank()) return 0.0
        val v = s.trim().toDoubleOrNull()
        require(v != null && v.isFinite() && v >= 0) { "$what ต้องเป็นตัวเลขไม่ติดลบ" }
        return v
    }
}
