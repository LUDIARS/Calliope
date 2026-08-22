import type { CalliopeDb } from './client.ts';
import { makeConnectorRepository } from './repositories/connector.ts';
import { makeAutonomyRepository } from './repositories/autonomy.ts';
import { makeConfirmationRepository } from './repositories/confirmation.ts';
import { makeEstimateRepository } from './repositories/estimate.ts';
import { makePlanRepository } from './repositories/plan.ts';
import { makePriorityRepository } from './repositories/priority.ts';
import { makeRiskRepository } from './repositories/risk.ts';
import { makeSprintRepository } from './repositories/sprint.ts';
import { makeVelocityRepository } from './repositories/velocity.ts';
import { makeCalendarRepository } from './repositories/calendar.ts';
import { makeServiceMapRepository } from './repositories/servicemap.ts';

export type { ConnectorHealth, ConnectorStateInput } from './repositories/connector.ts';
export type { ConfirmedPlanApplyInput } from './repositories/autonomy.ts';
export type { ConfirmationInput, ConfirmationKind, ConfirmationStatus } from './repositories/confirmation.ts';
export type { EstimateSource, TaskEstimateInput } from './repositories/estimate.ts';
export type { NewPlan, NewPlanEntry, RescheduleLogInput } from './repositories/plan.ts';
export type { PriorityInput, PriorityScope } from './repositories/priority.ts';
export type { GoalRiskLevel, GoalRiskSnapshotInput } from './repositories/risk.ts';
export type {
  CurveSnapshotInput,
  NewSprint,
  NewSprintTask,
  SprintStatus,
  SprintTaskStateInput,
  SprintTaskStatus,
} from './repositories/sprint.ts';
export type { NewVelocity, VelocityFilter } from './repositories/velocity.ts';
export type { CalendarLinkInput } from './repositories/calendar.ts';
export type {
  ServiceMapDomainInput,
  ServiceMapDomainRow,
  ServiceMapGroupInput,
  ServiceMapGroupRow,
  ServiceMapPcInput,
  ServiceMapPcRow,
  ServiceMapServiceInput,
  ServiceMapServicePatch,
  ServiceMapServiceRow,
  ServiceMapVillaImportInput,
} from './repositories/servicemap.ts';

/** @implements SPEC-SERVICE-MAP-PERSISTENCE (service-map repository composition) */
export function makeRepository(db: CalliopeDb) {
  return {
    ...makeCalendarRepository(db),
    ...makeAutonomyRepository(db),
    ...makeConfirmationRepository(db),
    ...makeConnectorRepository(db),
    ...makeEstimateRepository(db),
    ...makePlanRepository(db),
    ...makePriorityRepository(db),
    ...makeRiskRepository(db),
    ...makeSprintRepository(db),
    ...makeVelocityRepository(db),
    ...makeServiceMapRepository(db),
  };
}

export type CalliopeRepository = ReturnType<typeof makeRepository>;
