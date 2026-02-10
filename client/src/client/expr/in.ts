import { BaseOperator } from './operator';

export class InOperator extends BaseOperator {
  readonly name = '$in';

  match(foundValue: any, queryValue: any, fieldKey?: string): boolean {
    if (!Array.isArray(queryValue)) return false;
    let inValues = queryValue;
    if (fieldKey === '_id') {
      inValues = inValues.map((id) => id?.toString());
    }
    if (Array.isArray(foundValue)) {
      return inValues.some((item) => foundValue.includes(item));
    }
    return inValues.includes(foundValue);
  }

  compare(actualValue: any, queryValue: any): boolean {
    return Array.isArray(queryValue) ? queryValue.includes(actualValue) : false;
  }

  expression(left: any, right: any): boolean {
    return Array.isArray(right) ? right.includes(left) : false;
  }
}
