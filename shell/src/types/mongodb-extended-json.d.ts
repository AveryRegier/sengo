declare module 'mongodb-extended-json' {
  const EJSON: {
    parse: (input: string) => any;
    stringify: (input: any) => string;
  };
  export = EJSON;
}
