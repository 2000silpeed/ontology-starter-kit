# ontology-starter-kit

**타입화된 온톨로지 레이어 스타터 킷** — 메타데이터가 설명하는 객체 타입·링크·검증된 액션에 감사(감사 로그)와 권한 게이트를 얹고, 에이전트 도구까지 자동 생성하는 최소 구현.

> A minimal typed ontology layer: metadata-driven object types, links, validated actions with audit logs, a caller-identity gate, and an optional agent runtime. Written in TypeScript (Hono + Kysely + Postgres).

이 저장소는 특정 강의·상품의 자료를 복제한 것이 아니라, 온톨로지 레이어 아키텍처 패턴의 **독참 참조 구현**입니다. MIT 라이선스로 자유롭게 포크·변경·상용 적용할 수 있습니다.

---

## 왜 이 패턴인가

LLM 에이전트에게 데이터를 연결하는 방식은 크게 셋입니다:

| 방식 | 경계 | 문제 |
|---|---|---|
| Raw SQL | 없음 | 에이전트가 검증·감사를 우회하고, 스키마를 직접 알아야 함 |
| RAG | 읽기 전용 | 비정형 검색엔 유용하지만 객체 신원·링크를 잃고, 쓰기 불가 |
| **Typed Actions** | **액션 수준** | 검증·감사·트랜잭션이 자동 적용. 읽기와 쓰기 모두 경계 안에 |

이 킷은 세 번째 방식의 최소 골격입니다. 에이전트는 커질수록 불안정하고, **모델(온톨로지)이 무게를 짊어질수록 에이전트는 작아지고 안정됩니다.**

## 아키텍처

```
사람(UI/curl)  ─┐
                ├─►  Hono API  ──►  액션 라우트 ──► 핸들러 ──► Postgres
에이전트(SDK)  ─┘        │            (게이트·검증·      │
                         │             감사: 한 트랜잭션) │
                    /meta/* ◄── 메타데이터 테이블 ◄──────┘
                         (객체 타입·속성·링크·액션 정의)
```

- **메타데이터가 UI·API·에이전트 도구를 결정**합니다. 새 객체 타입은 메타 테이블의 INSERT 한 줄로 추가되고, 코드 재배포가 필요 없습니다.
- **쓰기 표면은 액션 라우트 하나뿐**입니다. 모든 비즈니스 상태 변경은 `READ → VALIDATE → WRITE → AUDIT`을 거치며, 감사 로그와 데이터 변경이 하나의 트랜잭션으로 커밋됩니다.
- **에이전트에게는 액션만 노출**됩니다. 도구 목록은 `action_type` 메타데이터에서 자동 생성되고, `allowed_callers` 게이트가 호출자를 검증합니다.

## 빠른 시작

요구사항: Node 23.6+, Docker(또는 PG 13+ Postgres)

```bash
# 1) Postgres 기동
docker compose up -d

# 2) 설정
cp .env.example .env   # 기본값 그대로 동작

# 3) 의존성 + 스키마/시드
npm install
npm run db:init        # db/001_meta.sql, 002_domain.sql, 003_seed.sql 순차 적용

# 4) 서버 실행
npm run dev            # http://localhost:3456
```

확인해 보기:

```bash
curl localhost:3456/health
curl localhost:3456/meta/types/delivery          # 타입·속성·링크·액션 정의 조회
curl localhost:3456/objects/delivery/DEL-0001    # 단일 객체 + 링크된 객체까지 반환

# 액션 실행 (납품 출하일 연기)
curl -X POST localhost:3456/actions/delivery/DEL-0001/deferShipment \
  -H 'content-type: application/json' \
  -H 'x-caller-identity: planner' \
  -d '{"newShippedAt":"2026-12-01","reason":"원자재 입고 지연"}'
```

## 핵심 개념

### 메타데이터 4요소 (`db/001_meta.sql`)

| 테이블 | 역할 |
|---|---|
| `object_type` | 도메인 객체의 카테고리. `api_name`(안정 URL/도구 이름) + `name`(표시명, 바꿔도 안전) 분리 |
| `object_property` | 속성 정의 — API 이름 ↔ 물리 컬럼 매핑, 필수 여부, 검색 가능 여부 |
| `object_link` | 객체 간 관계 — FK 컬럼 기반(N:1), 정방향/역방향 이름 포함 |
| `action_type` | 액션 정의 — JSON Schema 파라미터, `allowed_callers` 게이트 |

### 액션 = 유일한 쓰기 표면

```
POST /actions/:objectType/:id/:actionName
  ① 타입·액션 해석 (메타데이터)
  ② 권한 게이트 (x-caller-identity ↔ allowed_callers)  → 거부 시 access_log
  ③ 파라미터 검증 (JSON Schema)
  ④ 핸들러: READ → VALIDATE → WRITE   ← 하나의 트랜잭션
  ⑤ 감사 Row 커밋 (성공 'ok' / 실패 'error')
```

- UI 버튼도, 에이전트 도구도, curl도 **전부 같은 엔드포인트**를 씁니다.
- 거부 결정은 `access_log`에, 실행 결과는 `audit_log`에 기록됩니다. 라벨링과 인가는 별개입니다.

### Proposal (사람 승인) 패턴

에이전트가 스스로 상태를 바꾸면 사람은 끝난 뒤에야 알게 됩니다. 그래서 **의도가 머무는 자리**로 `proposal` 객체를 도메인 안에 둡니다:

```
에이전트 → POST /objects/proposal (status: pending, 근거 포함)
        → 사람이 검토 (Queue에서 확인)
        → POST /actions/proposal/PRP-0001/approve
             ① 저장된 target·params로 실제 액션 실행 (자체 검증 재적용)
             ② proposal을 approved로 표기 — 결정과 실행이 하나의 감사 사슬
        → reject은 아무것도 실행하지 않고 결정만 기록
```

시드 데이터에 `PRP-0001`(pending 제안)이 들어 있습니다. 직접 승인해 보세요:

```bash
curl -X POST localhost:3456/actions/proposal/PRP-0001/approve \
  -H 'content-type: application/json' \
  -H 'x-caller-identity: manager' \
  -d '{"decisionNote":"원자재 지연 확인"}'
# x-caller-identity를 빼거나 'planner'로 보내면 403 (allowed_callers 게이트)
```

## 새 도메인 적용하기 (5단계)

예시 도메인(주문/납품)을 자신의 도메인으로 바꾸는 절차입니다. **유즈케이스가 모델을 결정**합니다 — "액션이 필요하면 객체, 아니면 속성"이 기준입니다.

### 1. 인스턴스 테이블 작성 (`db/002_domain.sql` 교체)

- 비즈니스 ID를 TEXT PK로 (`SO-2026-0001`) — 추적성이 UUID보다 중요합니다.
- 문서 간 흐름(주문→납품)은 FK로 표현하고, 링크 메타에서 노출합니다.
- 관계가 "타입화되어 있고 미리 정의됨" → 그래프 DB가 아니라 관계형이 정답인지 확인하세요.

### 2. 메타데이터 등록 (`db/003_seed.sql` 패턴 복사)

`object_type` 1줄 + `object_property` N줄 + 필요한 `object_link`. 이것으로 `/meta`, `/objects`, `/query` 라우트와 에이전트 읽기 도구가 즉시 작동합니다.

### 3. 액션 정의

- `action_type`에 `api_name`(Type.verb 명명: `deferShipment`), 설명(에이전트가 이 문장으로 도구 사용을 판단합니다), `parameter_schema`(JSON Schema), 필요 시 `allowed_callers`를 INSERT.
- `src/actions/`에 핸들러 추가: READ → VALIDATE(비즈니스 규칙 위반 시 `ActionError`) → WRITE → RETURN. 감사는 라우트가 처리합니다.
- **핸들러와 메타 Row는 항상 함께 추가** — Row 없는 핸들러는 도달 불가능합니다.

### 4. 검증

```bash
curl localhost:3456/meta/types/<새타입>
curl localhost:3456/objects/<새타입>?limit=5
# 액션 성공/거부/검증실패 케이스를 각각 실행해 access_log·audit_log 확인
SELECT * FROM onto_meta.audit_log ORDER BY id DESC LIMIT 5;
SELECT * FROM onto_meta.access_log ORDER BY id DESC LIMIT 5;
```

### 5. 확장 — 필요해졌을 때

- **HITL 승인**: proposal 패턴을 복사 (actions/proposal.approve 참고)
- **관찰 가능성**: Langfuse 같은 트레이서를 래퍼에 붙임 (에이전트 행위 감사)
- **외부 시스템 호출**: 멱등성 키 + "시도됨 먼저 기록(Log-first)" + 실패 정책(중요/안내/비동기)
- **소스 동기화**: 소스가 소유한 속성은 소스가 이기고, 액션이 수정한 속성만 유지(속성 단위 병합). 소스로의 쓰기(writeback)는 opt-in

## 에이전트 연결

```bash
# .env에 ANTHROPIC_API_KEY 추가 후
npm run agent -- "DEL-0002가 왜 지연될 것 같은지 관련 객체를 찾아서 요약해줘"
```

- `src/agent/ontologyTools.ts`가 `/meta/actions`를 읽어 **액션을 도구로 자동 변환**합니다:
  - `api_name` → 도구 이름 (`delivery_defer_shipment`)
  - `description` → 도구 설명 (에이전트가 언제 쓸지 판단하는 근거)
  - `parameter_schema` → 입력 스키마 (zod shape로 변환)
  - 핸들러 → 액션 엔드포인트 호출
- 읽기 도구 2종(`query_objects`, `get_object`)은 고정 제공.
- `allowedTools`로 에이전트가 쓸 수 있는 도구를 온톨로지 것만 제한합니다. 에이전트에게 없는 능력은 에이전트가 쓸 수 없습니다.

## SAP ERP에 적용하기

이 패턴은 SAP 환경에서 다음과 같이 대응됩니다:

| 이 킷의 요소 | SAP 대응 |
|---|---|
| 인스턴스 테이블 | 표준/커스텀 테이블(또는 CDS view 기반 복제) |
| 액션 (Type.verb) | BAPI 래퍼 — 에이전트에게는 BAPI만 노출, 직접 UPDATE 금지 |
| 핸들러 안의 검증 | BAPI가 이미 품은 비즈니스 검증을 신뢰 |
| `allowed_callers` 게이트 | 권한 객체 + 에이전트별 서비스 유저 |
| audit_log / access_log | 변경문서(CDHDR/CDPOS) + 애플리케이션 로그의 보완재 |
| Proposal 승인 | 구매요청→오더, 워크플로우 승인과 동형 |
| 소스 동기화·속성 단위 병합 | ERP를 기록의 원천(SoR)으로 유지, 레이어가 읽기 + opt-in writeback |

SAP 조직 도입 시에는 위 매핑에 더해 7단계 절차(질문 정의 → 용어사전 → 개념모델 → 형식화 → 적재 → 추론·검증 → 응용·거버넌스)와 2주 MVP 플랜을 권장합니다. 조직의 도메인 오너 합의와 권한 설계가 기술보다 먼저입니다.

## 설계 원칙 요약

1. **메타데이터가 코드를 이긴다** — 타입·액션 추가는 INSERT, 재배포 아님.
2. **쓰기는 액션으로만** — PATCH/자유 UPDATE는 감사·검증·권한을 무력화.
3. **감사와 데이터는 한 트랜잭션** — 유령 쓰기·유령 로그 방지.
4. **도구 세트가 곧 권한** — 에이전트별로 노출 도구를 다르게.
5. **에이전트 오류는 프롬프트 문제가 아닌 경우가 많다** — 안 가져온 객체, 안 따라간 링크, 미모델링 사실 순으로 점검.
6. **학습 루프는 직접 만든다** — 감사 로그 + 사람의 최종 판정을 결합해야 평가셋이 된다.

## 검증 상태

- `npm run typecheck` 통과 (strict 모드)
- 런타임 동작은 위 "빠른 시작"으로 로컬 Postgres에서 확인하세요 (이 저장소 작성 환경에는 Docker가 없어 라이브 스모크 테스트는 포함되지 않았습니다).

## 라이선스

MIT — 자유롭게 포크하세요. 이 저장소는 독참 구현이며, 어떤 유료 강의·상품의 자료도 포함하지 않습니다.
