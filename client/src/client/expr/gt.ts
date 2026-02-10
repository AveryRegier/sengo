import { BaseOperator } from './operator';

export class GtOperator extends BaseOperator {
  readonly name = '$gt';

  match(foundValue: any, queryValue: any): boolean {
    return foundValue > queryValue;
  }

  compare(actualValue: any, queryValue: any): boolean {
    return actualValue > queryValue;
  }

  expression(left: any, right: any): boolean {
    return left > right;
  }
}
