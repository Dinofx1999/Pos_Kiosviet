import { InputNumber, InputNumberProps } from 'antd';
import { ElementRef, forwardRef } from 'react';
import { moneyFormatter, moneyParser } from '../utils/format';

export const MoneyInput = forwardRef<ElementRef<typeof InputNumber>, InputNumberProps>(function MoneyInput(props, ref) {
  return <InputNumber ref={ref} min={0} style={{ width: '100%' }} formatter={moneyFormatter as any} parser={moneyParser as any} controls={false} {...props} />;
});
/** Quantity: up to 3 decimals, no forced trailing zeros (antd keeps what the user typed). */
export const QuantityInput = forwardRef<ElementRef<typeof InputNumber>, InputNumberProps>(function QuantityInput(props, ref) {
  return <InputNumber ref={ref} style={{ width: '100%' }} controls={false} step={1} {...props} />;
});
