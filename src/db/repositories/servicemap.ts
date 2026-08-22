import { eq } from 'drizzle-orm';
import type { CalliopeDb } from '../client.ts';
import {
  connectorState,
  serviceMapDomain,
  serviceMapGroup,
  serviceMapPc,
  serviceMapRoadmap,
  serviceMapService,
} from '../schema.ts';

export type ServiceMapPcRow = typeof serviceMapPc.$inferSelect;
export type ServiceMapDomainRow = typeof serviceMapDomain.$inferSelect;
export type ServiceMapGroupRow = typeof serviceMapGroup.$inferSelect;
export type ServiceMapServiceRow = typeof serviceMapService.$inferSelect;

export type ServiceMapPcInput = typeof serviceMapPc.$inferInsert;
export type ServiceMapDomainInput = typeof serviceMapDomain.$inferInsert;
export type ServiceMapGroupInput = typeof serviceMapGroup.$inferInsert;
export type ServiceMapServiceInput = typeof serviceMapService.$inferInsert;

export type ServiceMapServicePatch = Partial<Pick<ServiceMapServiceInput,
  'groupIds' | 'pcIds' | 'cadence' | 'load'>> & { updatedAt: string };

export interface ServiceMapVillaImportInput {
  markerService: string;
  importedAt: string;
  pcs: ServiceMapPcInput[];
  groups: ServiceMapGroupInput[];
  services: ServiceMapServiceInput[];
}

/** @implements SPEC-SERVICE-MAP-PERSISTENCE */
export function makeServiceMapRepository(db: CalliopeDb) {
  return {
    async listPcs(): Promise<ServiceMapPcRow[]> {
      return db.select().from(serviceMapPc);
    },

    async upsertPc(input: ServiceMapPcInput) {
      const { id, ...rest } = input;
      await db.insert(serviceMapPc).values(input).onConflictDoUpdate({
        target: serviceMapPc.id,
        set: rest,
      });
    },

    async deletePc(id: string, updatedAt: string) {
      await db.transaction((tx) => {
        const services = tx.select().from(serviceMapService).all();
        for (const service of services) {
          if (!service.pcIds.includes(id)) continue;
          tx.update(serviceMapService)
            .set({ pcIds: service.pcIds.filter((pcId) => pcId !== id), updatedAt })
            .where(eq(serviceMapService.id, service.id)).run();
        }
        tx.delete(serviceMapPc).where(eq(serviceMapPc.id, id)).run();
      });
    },

    async listDomains(): Promise<ServiceMapDomainRow[]> {
      return db.select().from(serviceMapDomain);
    },

    async upsertDomain(input: ServiceMapDomainInput) {
      const { id, ...rest } = input;
      await db.insert(serviceMapDomain).values(input).onConflictDoUpdate({
        target: serviceMapDomain.id,
        set: rest,
      });
    },

    async deleteDomain(id: string) {
      await db.delete(serviceMapDomain).where(eq(serviceMapDomain.id, id));
    },

    async listGroups(): Promise<ServiceMapGroupRow[]> {
      return db.select().from(serviceMapGroup);
    },

    async upsertGroup(input: ServiceMapGroupInput) {
      const { id, ...rest } = input;
      await db.insert(serviceMapGroup).values(input).onConflictDoUpdate({
        target: serviceMapGroup.id,
        set: rest,
      });
    },

    /** 削除した group への JSON 参照を同一 transaction で fallback へ付け替える。 */
    async deleteGroup(id: string, fallback: ServiceMapGroupInput) {
      await db.transaction((tx) => {
        tx.insert(serviceMapGroup).values(fallback).onConflictDoNothing({
          target: serviceMapGroup.id,
        }).run();
        const services = tx.select().from(serviceMapService).all();
        for (const service of services) {
          if (!service.groupIds.includes(id)) continue;
          const remaining = service.groupIds.filter((groupId) => groupId !== id);
          tx.update(serviceMapService)
            .set({
              groupIds: remaining.length ? remaining : [fallback.id],
              updatedAt: fallback.updatedAt,
            })
            .where(eq(serviceMapService.id, service.id)).run();
        }
        tx.delete(serviceMapGroup).where(eq(serviceMapGroup.id, id)).run();
      });
    },

    async listServices(): Promise<ServiceMapServiceRow[]> {
      return db.select().from(serviceMapService);
    },

    async getService(id: string): Promise<ServiceMapServiceRow | null> {
      const rows = await db.select().from(serviceMapService).where(eq(serviceMapService.id, id)).limit(1);
      return rows[0] ?? null;
    },

    async upsertService(input: ServiceMapServiceInput) {
      const { id, ...rest } = input;
      await db.insert(serviceMapService).values(input).onConflictDoUpdate({
        target: serviceMapService.id,
        set: rest,
      });
    },

    /** 管理者所有フィールドだけを部分更新し、並行する catalog 同期との lost update を避ける。 */
    async patchService(id: string, patch: ServiceMapServicePatch) {
      await db.update(serviceMapService).set(patch).where(eq(serviceMapService.id, id));
    },

    /**
     * catalog 由来の列だけを一括反映する。既存行の割当・cadence・load は transaction
     * 開始時点の値を保持するため、上流取得中に行われた管理編集を巻き戻さない。
     */
    async applyCatalogSync(groups: ServiceMapGroupInput[], rows: ServiceMapServiceInput[]) {
      await db.transaction((tx) => {
        for (const group of groups) {
          tx.insert(serviceMapGroup).values(group).onConflictDoNothing({
            target: serviceMapGroup.id,
          }).run();
        }
        for (const row of rows) {
          tx.insert(serviceMapService).values(row).onConflictDoUpdate({
            target: serviceMapService.id,
            set: {
              code: row.code,
              name: row.name,
              projectCode: row.projectCode,
              tier: row.tier,
              port: row.port,
              description: row.description,
              runState: row.runState,
              inCatalog: row.inCatalog,
              manual: row.manual,
              lastSyncedAt: row.lastSyncedAt,
              updatedAt: row.updatedAt,
            },
          }).run();
        }
      });
    },

    /** Villa 台帳と完了 marker を同一 transaction で保存し、再実行と部分移行を防ぐ。 */
    async applyVillaImport(input: ServiceMapVillaImportInput): Promise<boolean> {
      return db.transaction((tx) => {
        const marker = tx.select().from(connectorState)
          .where(eq(connectorState.service, input.markerService)).all()[0];
        if (marker?.cursor === 'complete') return false;

        for (const pc of input.pcs) {
          const { id, ...rest } = pc;
          tx.insert(serviceMapPc).values(pc).onConflictDoUpdate({
            target: serviceMapPc.id,
            set: rest,
          }).run();
        }
        for (const group of input.groups) {
          const { id, ...rest } = group;
          tx.insert(serviceMapGroup).values(group).onConflictDoUpdate({
            target: serviceMapGroup.id,
            set: rest,
          }).run();
        }
        // code は unique。Villa の legacy ID (svc- prefix なし) は同期済み行の
        // ID (svc-<code>) と食い違うため、id ではなく code で既存行を引き当てる。
        // 引き当てずに挿入すると unique 制約で移行全体が落ちる。
        const idByCode = new Map(tx.select().from(serviceMapService).all()
          .map((row) => [row.code, row.id]));
        for (const service of input.services) {
          const id = idByCode.get(service.code) ?? service.id;
          const { id: _ignored, ...rest } = service;
          tx.insert(serviceMapService).values({ ...service, id }).onConflictDoUpdate({
            target: serviceMapService.id,
            set: rest,
          }).run();
          idByCode.set(service.code, id);
        }
        tx.insert(connectorState).values({
          service: input.markerService,
          health: 'ok',
          cursor: 'complete',
          updatedAt: input.importedAt,
        }).onConflictDoUpdate({
          target: connectorState.service,
          set: {
            health: 'ok',
            cursor: 'complete',
            updatedAt: input.importedAt,
          },
        }).run();
        return true;
      });
    },

    async getActiveRoadmap() {
      const rows = await db.select().from(serviceMapRoadmap)
        .where(eq(serviceMapRoadmap.status, 'active'))
        .limit(1);
      return rows[0] ?? null;
    },

    /** 旧 active を supersede してから新しいスナップショットを active で保存する。 */
    async saveRoadmap(input: { id: string; payload: unknown; generatedAt: string }) {
      await db.transaction((tx) => {
        const actives = tx.select().from(serviceMapRoadmap).where(eq(serviceMapRoadmap.status, 'active')).all();
        for (const row of actives) {
          tx.update(serviceMapRoadmap)
            .set({ status: 'superseded', supersededBy: input.id })
            .where(eq(serviceMapRoadmap.id, row.id)).run();
        }
        tx.insert(serviceMapRoadmap).values({
          id: input.id,
          status: 'active',
          payload: input.payload,
          generatedAt: input.generatedAt,
        }).run();
      });
    },
  };
}

export type ServiceMapRepository = ReturnType<typeof makeServiceMapRepository>;
