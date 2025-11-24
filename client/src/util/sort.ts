
export type SortDirection = 1 | -1;
export type Sort = Record<string, SortDirection>;
    
export const sort = <T>(sortSpec: Sort): (docs: T[]) => T[] => {
    return  (docs: T[]): T[] => {
        const sortKeys = Object.entries(sortSpec);
        return docs.sort((a: any, b: any) => {
            for (const [key, order] of sortKeys) {
                if (a[key] < b[key]) return order === 1 ? -1 : 1;
                if (a[key] > b[key]) return order === 1 ? 1 : -1;
            }
            return 0;
        });
    }
};