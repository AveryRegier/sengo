import { hello } from './index';

describe('hello', () => {
  it('should return the correct greeting', () => {
    expect(hello()).toBe('Hello from Sengo!');
  });
});
