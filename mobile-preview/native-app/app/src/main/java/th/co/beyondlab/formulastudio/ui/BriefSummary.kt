package th.co.beyondlab.formulastudio.ui

import th.co.beyondlab.formulastudio.domain.Brief

/** Label/value lines of a brief, shared by the simulated and the live (read-only) detail screens. Blank values are dropped. */
fun briefLines(b: Brief): List<Pair<String, String>> = listOf(
    "รูปแบบ" to b.form, "ขนาดบรรจุ" to "${b.size} ${b.sizeUnit}".trim(), "น้ำหนัก/หน่วย" to "${b.uw} ${b.uwUnit}".trim(),
    "หมวด" to "${b.cat} ${b.subcat}".trim(), "กลุ่มเป้าหมาย" to b.finalTarget, "เพศ" to b.gender, "ราคา/หน่วย" to b.price,
    "ความสำคัญ" to b.priority, "อย." to b.fdaType, "สี/กลิ่น/รส" to listOf(b.color, b.scent, b.flavor).filter { it.isNotBlank() }.joinToString(" / "),
    "บรรจุ" to b.packType, "ขนาดกล่อง" to if (b.widthCm.isNotBlank() || b.lengthCm.isNotBlank()) "${b.widthCm.ifBlank { "-" }} × ${b.lengthCm.ifBlank { "-" }} ซม." else "",
    "เบอร์" to b.phone, "หมายเหตุ" to b.notes,
).filter { it.second.isNotBlank() }
