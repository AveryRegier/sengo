import { BaseOperator } from './operator';

export class EqOperator extends BaseOperator {
  readonly name = '$eq';

  match(foundValue: any, queryValue: any): boolean {
    if (Array.isArray(foundValue)) {
      return (
        foundValue.includes(queryValue) ||
        foundValue.map((fv) => fv?.toString()).includes(queryValue?.toString())
      );
    }
    return foundValue?.toString() === queryValue?.toString();
  }

  compare(actualValue: any, queryValue: any): boolean {
    return actualValue === queryValue;
  }

  expression(left: any, right: any): boolean {
    return left === right;
  }
}
