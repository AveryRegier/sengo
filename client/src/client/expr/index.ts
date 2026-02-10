import { BaseOperator } from './operator';
import { EqOperator } from './eq';
import { NeOperator } from './ne';
import { GtOperator } from './gt';
import { GteOperator } from './gte';
import { LtOperator } from './lt';
import { LteOperator } from './lte';
import { InOperator } from './in';
import { NinOperator } from './nin';
import { ExistsOperator } from './exists';

export {
  BaseOperator,
  EqOperator,
  NeOperator,
  GtOperator,
  GteOperator,
  LtOperator,
  LteOperator,
  InOperator,
  NinOperator,
  ExistsOperator,
};

const operatorRegistry: Record<string, BaseOperator> = {
  $eq: new EqOperator(),
  $ne: new NeOperator(),
  $gt: new GtOperator(),
  $gte: new GteOperator(),
  $lt: new LtOperator(),
  $lte: new LteOperator(),
  $in: new InOperator(),
  $nin: new NinOperator(),
  $exists: new ExistsOperator(),
};

export function getOperator(op: string): BaseOperator | undefined {
  return operatorRegistry[op];
}
