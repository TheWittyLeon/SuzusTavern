/**
 * Smoke tests — verifies that every component mounts without throwing
 * and exposes the data-component sentinel attribute used in integration tests.
 *
 * Pass-1 components (Button, Card, Pill, Avatar, Icon, SectionHead) have full
 * implementations; their detailed behaviour tests are in the per-component files.
 *
 * Pass-2 components (Die, SuzuDM, Stat, Waveform, Aurora) are fully implemented;
 * detailed behaviour tests live in their own per-component files.
 */
import { render, cleanup } from '@testing-library/react';
import Card from '@/components/Card';
import Button from '@/components/Button';
import Pill from '@/components/Pill';
import Die from '@/components/Die';
import Avatar from '@/components/Avatar';
import SuzuDM from '@/components/SuzuDM';
import Icon from '@/components/Icon';
import SectionHead from '@/components/SectionHead';
import Stat from '@/components/Stat';
import Waveform from '@/components/Waveform';
import Aurora from '@/components/Aurora';

describe('Component smoke tests', () => {
  // Explicit cleanup after each smoke test ensures RTL unmounts components and
  // React flushes any pending effects (rAF loops, state updates) before the worker
  // moves to the next test file. Without this, Waveform's rAF and SuzuDM's
  // SVG animations can leave React scheduler work pending, which causes
  // intermittent SIGSEGV in jest-worker when running in parallel.
  afterEach(() => {
    cleanup();
  });

  it('Card mounts without throwing', () => {
    const { container } = render(<Card />);
    expect(container.firstChild).not.toBeNull();
    expect(container.querySelector('[data-component="Card"]')).toBeInTheDocument();
  });

  it('Button mounts without throwing', () => {
    const { container } = render(<Button>Click</Button>);
    expect(container.firstChild).not.toBeNull();
    expect(container.querySelector('[data-component="Button"]')).toBeInTheDocument();
  });

  it('Pill mounts without throwing', () => {
    const { container } = render(<Pill>Active</Pill>);
    expect(container.firstChild).not.toBeNull();
    expect(container.querySelector('[data-component="Pill"]')).toBeInTheDocument();
  });

  it('Die mounts without throwing (full implementation)', () => {
    const { container } = render(<Die />);
    expect(container.firstChild).not.toBeNull();
    expect(container.querySelector('[data-component="Die"]')).toBeInTheDocument();
  });

  it('Avatar mounts without throwing', () => {
    const { container } = render(<Avatar />);
    expect(container.firstChild).not.toBeNull();
    expect(container.querySelector('[data-component="Avatar"]')).toBeInTheDocument();
  });

  it('SuzuDM mounts without throwing (full implementation)', () => {
    const { container } = render(<SuzuDM />);
    expect(container.firstChild).not.toBeNull();
    expect(container.querySelector('[data-component="SuzuDM"]')).toBeInTheDocument();
  });

  it('Stat mounts without throwing', () => {
    const { container } = render(<Stat label="HP" value="120" />);
    expect(container.firstChild).not.toBeNull();
    expect(container.querySelector('[data-component="Stat"]')).toBeInTheDocument();
  });

  it('Waveform mounts without throwing', () => {
    const { container } = render(<Waveform />);
    expect(container.firstChild).not.toBeNull();
    expect(container.querySelector('[data-component="Waveform"]')).toBeInTheDocument();
  });

  it('Aurora mounts without throwing', () => {
    const { container } = render(<Aurora />);
    expect(container.firstChild).not.toBeNull();
    expect(container.querySelector('[data-component="Aurora"]')).toBeInTheDocument();
  });

  it('Icon mounts without throwing', () => {
    const { container } = render(<Icon name="Home" />);
    expect(container.firstChild).not.toBeNull();
    // Icon renders an <svg> — confirm it's present
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('SectionHead mounts without throwing', () => {
    const { container } = render(<SectionHead title="Test" />);
    expect(container.firstChild).not.toBeNull();
    expect(container.querySelector('[data-component="SectionHead"]')).toBeInTheDocument();
  });
});
