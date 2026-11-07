import { BaseOperator } from './operator';

export class ExistsOperator extends BaseOperator {
  readonly name = '$exists';

  match(foundValue: any, queryValue: any): boolean {
    const exists = foundValue !== undefined;
    return queryValue ? exists : !exists;
  }

  compare(actualValue: any, queryValue: any): boolean {
    const exists = actualValue !== undefined;
    return queryValue ? exists : !exists;
  }

  expression(): boolean {
    return this.notImplemented('expression');
  }
}
