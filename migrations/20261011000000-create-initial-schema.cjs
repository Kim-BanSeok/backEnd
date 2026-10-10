'use strict';
// ERD_테이블정리_수정본.md 의 PostgreSQL 테이블. CHECK 와 부분 UNIQUE 는 모델로 만들 수 없어 여기서 SQL 로 만든다.

module.exports = {
  async up(queryInterface, Sequelize) {
    // enum 목록은 앱과 같은 파일을 쓴다. (마이그레이션은 CommonJS 라 동적 import)
    const c = await import('../src/utils/codes.js');
    const list = (values) => values.map((v) => `'${v}'`).join(', ');
    const sql = (text) => queryInterface.sequelize.query(text);
    const check = (table, name, expr) =>
      sql(`ALTER TABLE ${table} ADD CONSTRAINT ${name} CHECK (${expr})`);

    const { BIGINT, INTEGER, SMALLINT, STRING, TEXT, BOOLEAN, DATE, DECIMAL, ARRAY } = Sequelize;
    const pk = () => ({ type: BIGINT, primaryKey: true, autoIncrement: true, allowNull: false });
    const fk = (table, key, { allowNull = false, onDelete = 'RESTRICT' } = {}) => ({
      type: BIGINT,
      allowNull,
      references: { model: table, key },
      onUpdate: 'CASCADE',
      onDelete,
    });
    const now = () => ({ type: DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') });
    const nullableDate = () => ({ type: DATE, allowNull: true });

    // ---- users
    await queryInterface.createTable('users', {
      user_id: pk('user_id'),
      email: { type: STRING(255), allowNull: false },
      password_hash: { type: STRING(255), allowNull: false },
      nickname: { type: STRING(50), allowNull: false },
      phone_number: { type: STRING(20), allowNull: true },
      role: { type: STRING(10), allowNull: false },
      seller_approval_status: { type: STRING(20), allowNull: true },
      privacy_agreed: { type: BOOLEAN, allowNull: false, defaultValue: false },
      terms_agreed: { type: BOOLEAN, allowNull: false, defaultValue: false },
      created_at: now(),
      updated_at: now(),
      deleted_at: nullableDate(),
    });
    // 탈퇴하지 않은 회원 사이에서만 이메일 중복 불가
    await sql('CREATE UNIQUE INDEX users_email_active_unique ON users (email) WHERE deleted_at IS NULL');
    await check('users', 'chk_users_role', `role IN (${list(c.ROLES)})`);
    await check(
      'users',
      'chk_users_seller_status',
      // NULL 이 CHECK 를 통과하지 않도록 IS NOT NULL 을 명시한다.
      `(role = 'SELLER' AND seller_approval_status IS NOT NULL AND seller_approval_status IN (${list(c.SELLER_APPROVAL_STATUSES)}))
       OR (role <> 'SELLER' AND seller_approval_status IS NULL)`,
    );

    // ---- stores
    await queryInterface.createTable('stores', {
      store_id: pk('store_id'),
      user_id: fk('users', 'user_id'),
      store_name: { type: STRING(100), allowNull: false },
      store_address: { type: STRING(255), allowNull: false },
      store_phone: { type: STRING(20), allowNull: false },
      closed_days: { type: STRING(100), allowNull: true },
      pickup_guide: { type: TEXT, allowNull: true },
      created_at: now(),
      updated_at: now(),
    });
    await queryInterface.addConstraint('stores', {
      fields: ['user_id'], type: 'unique', name: 'stores_user_id_unique', // 판매자당 매장 1개
    });

    // ---- patterns, pattern_parts
    await queryInterface.createTable('patterns', {
      pattern_id: pk('pattern_id'),
      pattern_name: { type: STRING(100), allowNull: false },
      aliases: { type: STRING(255), allowNull: true },
      category: { type: STRING(50), allowNull: true },
      description: { type: TEXT, allowNull: true },
      image_url: { type: STRING(500), allowNull: true },
      allowed_materials: { type: ARRAY(TEXT), allowNull: false },
      allowed_thickness: { type: ARRAY(TEXT), allowNull: false },
      reviewed_by: { type: STRING(50), allowNull: true },
      is_active: { type: BOOLEAN, allowNull: false, defaultValue: true },
      created_at: now(),
      updated_at: now(),
    });
    await queryInterface.createTable('pattern_parts', {
      part_id: pk('part_id'),
      pattern_id: fk('patterns', 'pattern_id', { onDelete: 'CASCADE' }),
      part_name: { type: STRING(50), allowNull: false },
      width_cm: { type: INTEGER, allowNull: false },
      height_cm: { type: INTEGER, allowNull: false },
      quantity: { type: INTEGER, allowNull: false, defaultValue: 1 },
    });
    await queryInterface.addIndex('pattern_parts', ['pattern_id'], { name: 'pattern_parts_pattern_id' });
    await check('pattern_parts', 'chk_parts_quantity', 'quantity >= 1');
    await check('pattern_parts', 'chk_parts_size', 'width_cm > 0 AND height_cm > 0');

    // ---- fabrics
    await queryInterface.createTable('fabrics', {
      fabric_id: pk('fabric_id'),
      store_id: fk('stores', 'store_id'),
      title: { type: STRING(100), allowNull: false },
      sale_type: { type: STRING(10), allowNull: false },
      price: { type: INTEGER, allowNull: false },
      remaining_length_cm: { type: INTEGER, allowNull: true },
      reserved_length_cm: { type: INTEGER, allowNull: false, defaultValue: 0 },
      status: { type: STRING(20), allowNull: false, defaultValue: 'PENDING' },
      reject_reason: { type: STRING(255), allowNull: true },
      created_at: now(),
      updated_at: now(),
      deleted_at: nullableDate(),
    });
    await check('fabrics', 'chk_fabrics_sale_type', `sale_type IN (${list(c.SALE_TYPES)})`);
    await check('fabrics', 'chk_fabrics_status', `status IN (${list(c.FABRIC_STATUSES)})`);
    await check('fabrics', 'chk_fabrics_nonneg', 'price >= 0 AND remaining_length_cm >= 0 AND reserved_length_cm >= 0');
    await check('fabrics', 'chk_fabrics_reserved', 'reserved_length_cm <= remaining_length_cm');
    await check(
      'fabrics',
      'chk_fabrics_stock',
      `(sale_type = 'ROLL' AND remaining_length_cm IS NOT NULL) OR (sale_type = 'SCRAP' AND remaining_length_cm IS NULL)`,
    );
    await check('fabrics', 'chk_fabrics_reject', `status <> 'REJECTED' OR reject_reason IS NOT NULL`);
    await queryInterface.addIndex('fabrics', ['status', 'sale_type'], { name: 'fabrics_status_sale_type' });
    await queryInterface.addIndex('fabrics', ['store_id'], { name: 'fabrics_store_id' });

    // ---- fabric_details
    await queryInterface.createTable('fabric_details', {
      fabric_detail_id: pk('fabric_detail_id'),
      fabric_id: fk('fabrics', 'fabric_id'),
      width_cm: { type: INTEGER, allowNull: false },
      length_cm: { type: INTEGER, allowNull: true },
      material: { type: STRING(20), allowNull: false, defaultValue: 'UNKNOWN' },
      thickness: { type: STRING(10), allowNull: false },
      color_family: { type: STRING(10), allowNull: false },
      color_detail: { type: STRING(100), allowNull: true },
      has_defect: { type: BOOLEAN, allowNull: false, defaultValue: false },
      defect_note: { type: STRING(255), allowNull: true },
      blend_ratio: { type: STRING(100), allowNull: true },
      weave: { type: STRING(50), allowNull: true },
      grain_direction: { type: STRING(50), allowNull: true },
      description: { type: TEXT, allowNull: true },
      created_at: now(),
      updated_at: now(),
    });
    await queryInterface.addConstraint('fabric_details', {
      fields: ['fabric_id'], type: 'unique', name: 'fabric_details_fabric_id_unique', // 원단당 상세 1개
    });
    await check('fabric_details', 'chk_details_defect', 'has_defect = FALSE OR defect_note IS NOT NULL');
    await check('fabric_details', 'chk_details_size', 'width_cm > 0');
    await check('fabric_details', 'chk_details_length', 'length_cm IS NULL OR length_cm BETWEEN 30 AND 90');
    await check('fabric_details', 'chk_details_material', `material IN (${list(c.MATERIALS)})`);
    await check('fabric_details', 'chk_details_thickness', `thickness IN (${list(c.THICKNESSES)})`);
    await check('fabric_details', 'chk_details_color', `color_family IN (${list(c.COLOR_FAMILIES)})`);

    // ---- fabric_images
    await queryInterface.createTable('fabric_images', {
      image_id: pk('image_id'),
      fabric_id: fk('fabrics', 'fabric_id'),
      image_url: { type: STRING(500), allowNull: false },
      thumbnail_url: { type: STRING(500), allowNull: true },
      image_type: { type: STRING(10), allowNull: true },
      sort_order: { type: SMALLINT, allowNull: false, defaultValue: 0 },
      created_at: now(),
    });
    await queryInterface.addConstraint('fabric_images', {
      fields: ['fabric_id', 'sort_order'], type: 'unique', name: 'fabric_images_fabric_sort_unique',
    });
    await check('fabric_images', 'chk_images_type', `image_type IS NULL OR image_type IN (${list(c.IMAGE_TYPES)})`);

    // ---- reservations
    await queryInterface.createTable('reservations', {
      reservation_id: pk('reservation_id'),
      fabric_id: fk('fabrics', 'fabric_id'),
      buyer_id: fk('users', 'user_id'),
      seller_id: fk('users', 'user_id'),
      pattern_id: fk('patterns', 'pattern_id', { allowNull: true }),
      requested_length_cm: { type: INTEGER, allowNull: true },
      estimated_price: { type: INTEGER, allowNull: true },
      pickup_at: { type: DATE, allowNull: false },
      memo: { type: STRING(500), allowNull: true },
      status: { type: STRING(20), allowNull: false, defaultValue: 'REQUESTED' },
      reject_reason: { type: STRING(255), allowNull: true },
      canceled_by: { type: STRING(10), allowNull: true },
      accepted_at: nullableDate(),
      picked_up_at: nullableDate(),
      canceled_at: nullableDate(),
      created_at: now(),
      updated_at: now(),
    });
    await check('reservations', 'chk_reservations_status', `status IN (${list(c.RESERVATION_STATUSES)})`);
    await check('reservations', 'chk_reservations_reject', `status <> 'REJECTED' OR reject_reason IS NOT NULL`);
    await check(
      'reservations',
      'chk_reservations_canceled',
      `(status <> 'CANCELED' OR canceled_by IS NOT NULL) AND (canceled_by IS NULL OR canceled_by IN (${list(c.CANCELED_BY)}))`,
    );
    await check(
      'reservations',
      'chk_reservations_length',
      'requested_length_cm IS NULL OR (requested_length_cm > 0 AND requested_length_cm % 90 = 0)',
    );
    await queryInterface.addIndex('reservations', ['fabric_id'], { name: 'reservations_fabric_id' });
    await queryInterface.addIndex('reservations', ['seller_id', 'status'], { name: 'reservations_seller_status' });
    await queryInterface.addIndex('reservations', ['buyer_id', 'status'], { name: 'reservations_buyer_status' });

    // ---- favorites
    await queryInterface.createTable('favorites', {
      favorite_id: pk('favorite_id'),
      user_id: fk('users', 'user_id'),
      target_type: { type: STRING(10), allowNull: false },
      fabric_id: fk('fabrics', 'fabric_id', { allowNull: true }),
      pattern_id: fk('patterns', 'pattern_id', { allowNull: true }),
      created_at: now(),
    });
    await check(
      'favorites',
      'chk_favorites_target',
      `(target_type = 'FABRIC' AND fabric_id IS NOT NULL AND pattern_id IS NULL)
       OR (target_type = 'PATTERN' AND pattern_id IS NOT NULL AND fabric_id IS NULL)`,
    );
    await queryInterface.addConstraint('favorites', {
      fields: ['user_id', 'fabric_id'], type: 'unique', name: 'favorites_user_fabric_unique',
    });
    await queryInterface.addConstraint('favorites', {
      fields: ['user_id', 'pattern_id'], type: 'unique', name: 'favorites_user_pattern_unique',
    });

    // ---- inquiries
    await queryInterface.createTable('inquiries', {
      inquiry_id: pk('inquiry_id'),
      fabric_id: fk('fabrics', 'fabric_id'),
      buyer_id: fk('users', 'user_id'),
      seller_id: fk('users', 'user_id'),
      content: { type: STRING(1000), allowNull: false },
      is_private: { type: BOOLEAN, allowNull: false, defaultValue: false },
      status: { type: STRING(20), allowNull: false, defaultValue: 'WAITING' },
      answer: { type: STRING(1000), allowNull: true },
      answered_at: nullableDate(),
      created_at: now(),
      updated_at: now(),
      deleted_at: nullableDate(),
    });
    await check('inquiries', 'chk_inquiries_status', `status IN (${list(c.INQUIRY_STATUSES)})`);
    await check('inquiries', 'chk_inquiries_answer', `status <> 'ANSWERED' OR answer IS NOT NULL`);
    await queryInterface.addIndex('inquiries', ['seller_id', 'status'], { name: 'inquiries_seller_status' });
    await queryInterface.addIndex('inquiries', ['fabric_id'], { name: 'inquiries_fabric_id' });

    // ---- factories (공공데이터, 임시)
    await queryInterface.createTable('factories', {
      factory_id: pk('factory_id'),
      factory_name: { type: STRING(100), allowNull: false },
      industry: { type: STRING(100), allowNull: true },
      address: { type: STRING(255), allowNull: false },
      latitude: { type: DECIMAL(10, 7), allowNull: true },
      longitude: { type: DECIMAL(10, 7), allowNull: true },
      data_source: { type: STRING(100), allowNull: false },
      created_at: now(),
    });
  },

  async down(queryInterface) {
    // FK 순서의 반대로 지운다.
    for (const table of [
      'factories', 'inquiries', 'favorites', 'reservations', 'fabric_images',
      'fabric_details', 'fabrics', 'pattern_parts', 'patterns', 'stores', 'users',
    ]) {
      await queryInterface.dropTable(table);
    }
  },
};
