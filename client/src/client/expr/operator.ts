import { notImplementedMongo } from '../../utils';
import type { Order } from '../../types';

export abstract class BaseOperator {
  abstract readonly name: string;

  abstract match(foundValue: any, queryValue: any, fieldKey?: string): boolean;
  abstract compare(actualValue: any, queryValue: any): boolean;
  abstract expression(left: any, right: any, fieldKey?: string): boolean;

  protected notImplemented(context: string): never {
    return notImplementedMongo(`Operator ${this.name} does not support ${context}`);
  }
}
