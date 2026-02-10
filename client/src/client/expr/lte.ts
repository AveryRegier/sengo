import { BaseOperator } from './operator';

export class LteOperator extends BaseOperator {
  readonly name = '$lte';

  match(foundValue: any, queryValue: any): boolean {
    return foundValue <= queryValue;
  }

  compare(actualValue: any, queryValue: any): boolean {
    return actualValue <= queryValue;
  }

  expression(left: any, right: any): boolean {
    return left <= right;
  }
}
