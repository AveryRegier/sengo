import { BaseOperator } from './operator';

export class NinOperator extends BaseOperator {
  readonly name = '$nin';

  match(foundValue: any, queryValue: any, fieldKey?: string): boolean {
    if (!Array.isArray(queryValue)) return true;
    let ninValues = queryValue;
    if (fieldKey === '_id') {
      ninValues = ninValues.map((id) => id?.toString());
    }
    if (Array.isArray(foundValue)) {
      return !ninValues.some((item) => foundValue.includes(item));
    }
    return !ninValues.includes(foundValue);
  }

  compare(actualValue: any, queryValue: any): boolean {
    return Array.isArray(queryValue) ? !queryValue.includes(actualValue) : true;
  }

  expression(): boolean {
    return this.notImplemented('expression');
  }
}
