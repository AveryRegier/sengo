import { BaseOperator } from './operator';

export class NeOperator extends BaseOperator {
  readonly name = '$ne';

  match(foundValue: any, queryValue: any): boolean {
    return foundValue !== queryValue;
  }

  compare(actualValue: any, queryValue: any): boolean {
    return actualValue !== queryValue;
  }

  expression(left: any, right: any): boolean {
    return left !== right;
  }
}
