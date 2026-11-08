export type FieldPathArrayPosition = {
  path: string;
  index: number;
};

export type FieldPathValue = {
  value: unknown;
  arrayAncestry: FieldPathArrayPosition[];
};

export type FieldPathResolution = {
  path: string;
  exists: boolean;
  values: FieldPathValue[];
};

export function resolveFieldPath(document: unknown, path: string): FieldPathResolution {
  const segments = path.split('.');
  const values: FieldPathValue[] = [];
  let exists = false;

  if (!path || segments.some(segment => segment.length === 0)) {
    return { path, exists: false, values };
  }

  const visit = (
    current: unknown,
    segmentIndex: number,
    currentPath: string,
    arrayAncestry: FieldPathArrayPosition[],
  ): void => {
    if (segmentIndex === segments.length) {
      values.push({ value: current, arrayAncestry });
      exists = exists || current !== undefined;
      return;
    }

    if (Array.isArray(current)) {
      current.forEach((value, index) => {
        visit(value, segmentIndex, currentPath, [...arrayAncestry, { path: currentPath, index }]);
      });
      return;
    }

    if (current === null || typeof current !== 'object') {
      return;
    }

    const segment = segments[segmentIndex];
    if (!Object.prototype.hasOwnProperty.call(current, segment)) {
      if (arrayAncestry.length > 0) {
        values.push({ value: undefined, arrayAncestry });
      }
      return;
    }

    visit(
      (current as Record<string, unknown>)[segment],
      segmentIndex + 1,
      currentPath ? `${currentPath}.${segment}` : segment,
      arrayAncestry,
    );
  };

  visit(document, 0, '', []);
  return { path, exists, values };
}

export function getFieldPathValues(document: unknown, path: string): FieldPathValue[] {
  return resolveFieldPath(document, path).values;
}

export function expandFieldPathArrays(resolution: FieldPathResolution): FieldPathValue[] {
  const expanded: FieldPathValue[] = [];

  const expand = (
    value: unknown,
    arrayAncestry: FieldPathArrayPosition[],
  ): void => {
    if (!Array.isArray(value)) {
      expanded.push({ value, arrayAncestry });
      return;
    }

    if (value.length === 0) {
      expanded.push({ value: null, arrayAncestry });
      return;
    }

    value.forEach((item, index) => {
      expand(item, [...arrayAncestry, { path: resolution.path, index }]);
    });
  };

  for (const fieldValue of resolution.values) {
    expand(fieldValue.value, fieldValue.arrayAncestry);
  }
  return expanded;
}

export function hasFieldPath(document: unknown, path: string): boolean {
  return resolveFieldPath(document, path).exists;
}
