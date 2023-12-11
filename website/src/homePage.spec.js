// tests/HomepageFeatures.test.js
import React from 'react';
import "@testing-library/jest-dom"
import { render, screen } from '@testing-library/react';
import HomepageFeatures from './components/HomepageFeatures';



describe('HomepageFeatures component', () => {
  test('renders all feature titles', () => {
    render(<HomepageFeatures />);

    screen.debug()

    expect(screen.getByText("Tabby")).toBeInTheDocument();
  });
});

describe('HomepageFeatures component', () => {
  test('renders all feature titles', () => {
    render(<index />);

    screen.debug()

    expect(screen.getByText("Tabby")).toBeInTheDocument();
  });
});
