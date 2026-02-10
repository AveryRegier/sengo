import { BaseOperator } from './operator';

export class LtOperator extends BaseOperator {
  readonly name = '$lt';

  match(foundValue: any, queryValue: any): boolean {
    return foundValue < queryValue;
  }

  compare(actualValue: any, queryValue: any): boolean {
    return actualValue < queryValue;
  }

  expression(left: any, right: any): boolean {
    return left < right;
  }
}
