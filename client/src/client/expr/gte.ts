import { BaseOperator } from './operator';

export class GteOperator extends BaseOperator {
  readonly name = '$gte';

  match(foundValue: any, queryValue: any): boolean {
    return foundValue >= queryValue;
  }

  compare(actualValue: any, queryValue: any): boolean {
    return actualValue >= queryValue;
  }

  expression(left: any, right: any): boolean {
    return left >= right;
  }
}
