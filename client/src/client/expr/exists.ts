import { BaseOperator } from './operator';

export class ExistsOperator extends BaseOperator {
  readonly name = '$exists';

  match(foundValue: any, queryValue: any): boolean {
    const exists = foundValue !== undefined && foundValue !== null && foundValue !== '';
    return queryValue ? exists : !exists;
  }

  compare(actualValue: any, queryValue: any): boolean {
    const exists = actualValue !== undefined && actualValue !== null && actualValue !== '';
    return queryValue ? exists : !exists;
  }

  expression(): boolean {
    return this.notImplemented('expression');
  }
}
