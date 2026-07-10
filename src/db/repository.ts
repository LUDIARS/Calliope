import type { CalliopeDb } from './client.ts';
import { makeConnectorRepository } from './repositories/connector.ts';
import { makeEstimateRepository } from './repositories/estimate.ts';
import { makePlanRepository } from './repositories/plan.ts';
import { makePriorityRepository } from './repositories/priority.ts';
import { makeVelocityRepository } from './repositories/velocity.ts';

export type { ConnectorHealth, ConnectorStateInput } from './repositories/connector.ts';
export type { EstimateSource, TaskEstimateInput } from './repositories/estimate.ts';
export type { NewPlan, NewPlanEntry, RescheduleLogInput } from './repositories/plan.ts';
export type { PriorityInput, PriorityScope } from './repositories/priority.ts';
export type { NewVelocity, VelocityFilter } from './repositories/velocity.ts';

export function makeRepository(db: CalliopeDb) {
  return {
    ...makeConnectorRepository(db),
    ...makeEstimateRepository(db),
    ...makePlanRepository(db),
    ...makePriorityRepository(db),
    ...makeVelocityRepository(db),
  };
}

export type CalliopeRepository = ReturnType<typeof makeRepository>;
