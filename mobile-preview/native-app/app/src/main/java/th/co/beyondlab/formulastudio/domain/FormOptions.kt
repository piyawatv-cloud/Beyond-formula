package th.co.beyondlab.formulastudio.domain

/** Dropdown/chip options copied from the web form (index.html f_form, f_category, ...). */
object FormOptions {
    val forms = listOf("แคปซูล", "เม็ดตอก", "ผงชงดื่ม", "ผงกรอกปาก", "เจลลี่ สตริป", "เจลลี่ ดริ้ง", "กัมมี่",
        "ช็อตดริ้ง", "ดรอปดริ้ง", "โอเวอร์แคป เม็ดตอก", "โอเวอร์แคป ลิควิด")
    val packUnits = listOf("เม็ด", "แคปซูล", "ซอง", "ขวด", "ชิ้น", "หลอด", "กล่อง", "กรัม", "มล.")
    val weightUnits = listOf("mg", "g", "mcg", "IU", "ml")
    val cats: Map<String, List<String>> = mapOf(
        "สินค้ามาตรฐาน (B_)" to listOf("BD : Detox", "BL : บำรุงผู้หญิง", "BM : บำรุงผู้ชาย", "BN : บำรุงร่างกาย", "BP : โปรตีน", "BS : ลดน้ำหนัก", "BW : บำรุงผิว"),
        "พัฒนาจากลูกค้า (D_)" to listOf("DD : Detox", "DL : บำรุงผู้หญิง", "DM : บำรุงผู้ชาย", "DN : บำรุงร่างกาย", "DP : โปรตีน", "DS : ลดน้ำหนัก", "DW : บำรุงผิว"),
    )
    val genders = listOf("หญิง", "ชาย", "ทุกเพศ")
    /** value to label; stored value is the key ('low'|'medium'|'high'). */
    val priorities = listOf("low" to "ต่ำ (low)", "medium" to "ปานกลาง (medium)", "high" to "สูง (high)")
    val fdaTypes = listOf("100% : จดแจ้งตรงทั้งหมด", "50% : Active ตรง / In-Active ไม่ตรง", "20% : Active 1-3 อย่าง")
    val packTypes = listOf("กระปุก / ขวดพลาสติก", "ขวดแก้ว", "ซอง (Sachet)", "สติ๊กแพ็ค (Stick Pack)",
        "แผงบลิสเตอร์ (Blister)", "กล่อง (Box)", "ถุงซิปล็อค", "หลอด (Tube)", "กระป๋อง", "ซองฟอยล์ 3 ด้าน", "อื่น ๆ")
    /** label shown to the user to stored concept string. */
    val concepts = listOf("ผิวขาว" to "ผิวขาว / Whitening", "ลดสิว" to "ลดสิว / Anti-Acne", "Detox" to "Detox / ล้างพิษ",
        "เสริมภูมิ" to "เสริมภูมิคุ้มกัน / Immune Boost", "ชะลอวัย" to "ชะลอวัย / Anti-Aging",
        "ลดน้ำหนัก" to "ลดน้ำหนัก / Weight Management", "ผม & เล็บ" to "บำรุงผม/เล็บ / Hair & Nail",
        "ลดอักเสบ" to "ลดอักเสบ / Anti-Inflammation")
}
