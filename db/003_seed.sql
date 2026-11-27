-- 003_seed.sql — sample data + metadata registrations for the orders domain.
-- Idempotent-ish: uses ON CONFLICT DO NOTHING where keys exist.

-- ── instance data ────────────────────────────────────────────────────────────
INSERT INTO onto_app.customer (id, name, country, tier) VALUES
  ('CUST-001', '한빛유통', 'KR', 'enterprise'),
  ('CUST-002', '그린마켓', 'VN', 'standard'),
  ('CUST-003', '오아시스마트', 'KR', 'standard')
ON CONFLICT (id) DO NOTHING;

INSERT INTO onto_app.plant (id, name, region) VALUES
  ('PLANT-100', '부산물류센터', 'KR-South'),
  ('PLANT-200', '호치민허브', 'VN-North')
ON CONFLICT (id) DO NOTHING;

INSERT INTO onto_app.sales_order (id, customer_id, status, currency, amount, ordered_at, requested_date) VALUES
  ('SO-2026-0001', 'CUST-001', 'confirmed', 'KRW', 1850000, '2026-11-20', '2026-12-05'),
  ('SO-2026-0002', 'CUST-002', 'open',      'KRW',  620000, '2026-11-24', '2026-12-10'),
  ('SO-2026-0003', 'CUST-003', 'confirmed', 'KRW',  990000, '2026-11-25', '2026-12-01')
ON CONFLICT (id) DO NOTHING;

INSERT INTO onto_app.delivery (id, sales_order_id, plant_id, status, shipped_at, carrier) VALUES
  ('DEL-0001', 'SO-2026-0001', 'PLANT-100', 'planned', '2026-11-28', '한진택배'),
  ('DEL-0002', 'SO-2026-0002', 'PLANT-200', 'planned', NULL,         NULL),
  ('DEL-0003', 'SO-2026-0003', 'PLANT-100', 'shipped', '2026-11-26', 'CJ대한통운')
ON CONFLICT (id) DO NOTHING;

INSERT INTO onto_app.proposal (id, action_name, target_type, target_id, params, reason, status, raised_by) VALUES
  ('PRP-0001', 'deferShipment', 'delivery', 'DEL-0002',
   '{"newShippedAt":"2026-12-01","reason":"벤더 원자재 입고 지연으로 초기 계획 변경"}'::jsonb,
   '원자재 지연으로 출하일 연도 조정 필요', 'pending', 'planning-agent')
ON CONFLICT (id) DO NOTHING;

-- ── metadata: object types ──────────────────────────────────────────────────
INSERT INTO onto_meta.object_type (api_name, name, description, datasource_schema, datasource_table, title_property, edits_enabled) VALUES
  ('customer',   '고객',        '주문을 넣는 거래처',                      'onto_app', 'customer',   'name', true),
  ('plant',      '플랜트',      '출하가 이루어지는 물류 거점',              'onto_app', 'plant',      'name', true),
  ('sales_order','판매 주문',   '고객 주문 문서',                          'onto_app', 'sales_order','id',   true),
  ('delivery',   '납품',        '주문을 실제로 옮기는 문서',                'onto_app', 'delivery',   'id',   true),
  ('proposal',   '승인 제안',   '에이전트의 실행 의도. 승인 전까지 아무 일도 일어나지 않음', 'onto_app', 'proposal', 'id', true)
ON CONFLICT (api_name) DO NOTHING;

-- ── metadata: properties ────────────────────────────────────────────────────
INSERT INTO onto_meta.object_property (object_type_id, api_name, name, data_type, required, is_title, datasource_column, searchable)
SELECT ot.id, v.api_name, v.name, v.data_type, v.required, v.is_title, v.col, v.searchable
FROM onto_meta.object_type ot,
     (VALUES
       ('id',        'ID',        'string', true,  true,  'id',        true),
       ('name',      '이름',      'string', true,  false, 'name',      true),
       ('country',   '국가',      'string', false, false, 'country',   true),
       ('tier',      '등급',      'string', true,  false, 'tier',      false)
     ) AS v(api_name, name, data_type, required, is_title, col, searchable)
WHERE ot.api_name = 'customer'
ON CONFLICT (object_type_id, api_name) DO NOTHING;

INSERT INTO onto_meta.object_property (object_type_id, api_name, name, data_type, required, is_title, datasource_column, searchable)
SELECT ot.id, v.api_name, v.name, v.data_type, v.required, v.is_title, v.col, v.searchable
FROM onto_meta.object_type ot,
     (VALUES
       ('id',     'ID',     'string', true,  true,  'id',     true),
       ('name',   '이름',   'string', true,  false, 'name',   true),
       ('region', '지역',   'string', false, false, 'region', true)
     ) AS v(api_name, name, data_type, required, is_title, col, searchable)
WHERE ot.api_name = 'plant'
ON CONFLICT (object_type_id, api_name) DO NOTHING;

INSERT INTO onto_meta.object_property (object_type_id, api_name, name, data_type, required, is_title, datasource_column, searchable)
SELECT ot.id, v.api_name, v.name, v.data_type, v.required, v.is_title, v.col, v.searchable
FROM onto_meta.object_type ot,
     (VALUES
       ('id',             '주문 번호',   'string', true,  true,  'id',             true),
       ('customerId',     '고객',        'string', true,  false, 'customer_id',    false),
       ('status',         '상태',        'string', true,  false, 'status',         true),
       ('currency',       '통화',        'string', true,  false, 'currency',       false),
       ('amount',         '금액',        'number', true,  false, 'amount',         false),
       ('orderedAt',      '주문일',      'date',   true,  false, 'ordered_at',     false),
       ('requestedDate',  '요청 납기',   'date',   false, false, 'requested_date', false)
     ) AS v(api_name, name, data_type, required, is_title, col, searchable)
WHERE ot.api_name = 'sales_order'
ON CONFLICT (object_type_id, api_name) DO NOTHING;

INSERT INTO onto_meta.object_property (object_type_id, api_name, name, data_type, required, is_title, datasource_column, searchable)
SELECT ot.id, v.api_name, v.name, v.data_type, v.required, v.is_title, v.col, v.searchable
FROM onto_meta.object_type ot,
     (VALUES
       ('id',           '납품 번호', 'string', true,  true,  'id',           true),
       ('salesOrderId', '판매 주문', 'string', true,  false, 'sales_order_id', false),
       ('plantId',      '플랜트',    'string', true,  false, 'plant_id',     false),
       ('status',       '상태',      'string', true,  false, 'status',       true),
       ('shippedAt',    '출하일',    'date',   false, false, 'shipped_at',   false),
       ('carrier',      '운송사',    'string', false, false, 'carrier',      true)
     ) AS v(api_name, name, data_type, required, is_title, col, searchable)
WHERE ot.api_name = 'delivery'
ON CONFLICT (object_type_id, api_name) DO NOTHING;

INSERT INTO onto_meta.object_property (object_type_id, api_name, name, data_type, required, is_title, datasource_column, searchable)
SELECT ot.id, v.api_name, v.name, v.data_type, v.required, v.is_title, v.col, v.searchable
FROM onto_meta.object_type ot,
     (VALUES
       ('id',           '제안 번호', 'string', true,  true,  'id',           true),
       ('actionName',   '대상 액션', 'string', true,  false, 'action_name',  true),
       ('targetType',   '대상 타입', 'string', true,  false, 'target_type',  false),
       ('targetId',     '대상 ID',   'string', true,  false, 'target_id',    true),
       ('reason',       '제안 사유', 'string', true,  false, 'reason',       true),
       ('status',       '상태',      'string', true,  false, 'status',       true),
       ('raisedBy',     '제안자',    'string', true,  false, 'raised_by',    true),
       ('decisionNote', '결정 메모', 'string', false, false, 'decision_note', false)
     ) AS v(api_name, name, data_type, required, is_title, col, searchable)
WHERE ot.api_name = 'proposal'
ON CONFLICT (object_type_id, api_name) DO NOTHING;

-- ── metadata: links ─────────────────────────────────────────────────────────
INSERT INTO onto_meta.object_link (api_name, name, inverse_name, source_type, target_type, cardinality, datasource_column) VALUES
  ('customer',   '고객',     'salesOrders', 'sales_order', 'customer', 'N:1', 'customer_id'),
  ('salesOrder', '판매 주문','deliveries',  'delivery',    'sales_order', 'N:1', 'sales_order_id'),
  ('plant',      '플랜트',   'deliveries',  'delivery',    'plant',    'N:1', 'plant_id')
ON CONFLICT (api_name) DO NOTHING;

-- ── metadata: action types ──────────────────────────────────────────────────
INSERT INTO onto_meta.action_type (api_name, name, description, object_type, parameter_schema, allowed_callers) VALUES
  ('deferShipment',
   '출하 연기',
   'planned 상태의 납품 출하일을 새 날짜로 미룬다. 상태가 planned가 아니면 거부한다.',
   'delivery',
   '{"type":"object","additionalProperties":false,"required":["newShippedAt","reason"],"properties":{"newShippedAt":{"type":"string","description":"새 출하일 (YYYY-MM-DD)"},"reason":{"type":"string","minLength":3,"description":"연기 사유 (감사에 기록됨)"}}}'::jsonb,
   NULL),
  ('approve',
   '제안 승인',
   '대기 중인 제안을 승인하고, 제안이 담고 있던 액션을 실제로 실행한다. 실행이 실패하면 제안은 pending으로 유지된다.',
   'proposal',
   '{"type":"object","additionalProperties":false,"properties":{"decisionNote":{"type":"string","description":"승인 사유 (감사에 기록됨)"}}}'::jsonb,
   ARRAY['manager', 'ops-agent']),
  ('reject',
   '제안 거부',
   '대기 중인 제안을 거부한다. 아무것도 실행되지 않고 결정만 기록된다.',
   'proposal',
   '{"type":"object","additionalProperties":false,"properties":{"decisionNote":{"type":"string","description":"거부 사유"}}}'::jsonb,
   ARRAY['manager', 'ops-agent'])
ON CONFLICT (api_name) DO NOTHING;
