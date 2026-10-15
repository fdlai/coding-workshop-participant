import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import ProjectHealthList from '../ProjectHealthList';
import { projectHealth as makeProject } from '../../test/fixtures';

const makeProjects = (count) => Array.from({ length: count }, (_, i) => makeProject(i + 1));

const renderList = (props) => render(<MemoryRouter><ProjectHealthList {...props} /></MemoryRouter>);
const projectLinks = () => screen.queryAllByRole('link').map((a) => a.textContent);

describe('ProjectHealthList', () => {
  it('shows an empty state when there are no projects', () => {
    renderList({ projects: [] });
    expect(screen.getByText('No active projects')).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('shows each project with manager, progress, budget and a link', () => {
    renderList({ projects: [makeProject(1)] });
    const link = screen.getByRole('link', { name: 'Project 1' });
    expect(link).toHaveAttribute('href', '/projects/1');
    const item = link.closest('li');
    expect(within(item).getByText('On track')).toBeInTheDocument();
    expect(item).toHaveTextContent('Max Manager · 1/4 milestones · 3 assigned · due Dec 31, 2030');
    expect(item).toHaveTextContent('$42,000 / $100,000');
    expect(within(item).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '42');
  });

  it('hides budget and manager when showBudget is false', () => {
    renderList({ projects: [makeProject(1)], showBudget: false });
    const item = screen.getByRole('link', { name: 'Project 1' }).closest('li');
    expect(item).not.toHaveTextContent('Max Manager');
    expect(item).not.toHaveTextContent('$');
    expect(within(item).queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('treats a missing utilization as 0%', () => {
    renderList({ projects: [makeProject(1, { budget_utilization_percent: null, estimated_budget: '0.00' })] });
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
  });

  it('filters by budget health with counts per option', async () => {
    renderList({ projects: makeProjects(5) }); // on_track: 1,4  at_risk: 2,5  over_budget: 3
    const filter = screen.getByRole('combobox', { name: 'Filter projects by budget health' });
    expect(within(filter).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'All projects (5)', 'On track (2)', 'At risk (2)', 'Over budget (1)',
    ]);

    await userEvent.selectOptions(filter, 'at_risk');
    expect(projectLinks()).toEqual(['Project 2', 'Project 5']);
    await userEvent.selectOptions(filter, 'over_budget');
    expect(projectLinks()).toEqual(['Project 3']);
    await userEvent.selectOptions(filter, 'all');
    expect(projectLinks()).toHaveLength(5);
  });

  it('shows an empty state when no project matches the filter', async () => {
    renderList({ projects: [makeProject(1)] });
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /budget health/ }), 'over_budget');
    expect(screen.getByText('No projects match this filter')).toBeInTheDocument();
  });

  it('pages through 25 projects at a time by default', async () => {
    renderList({ projects: makeProjects(60) });
    expect(screen.getByRole('combobox', { name: 'Projects per page' })).toHaveValue('25');
    expect(projectLinks()).toHaveLength(25);
    expect(screen.getByText('Page 1 of 3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('Page 2 of 3')).toBeInTheDocument();
    expect(projectLinks()[0]).toBe('Project 26');

    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('Page 3 of 3')).toBeInTheDocument();
    expect(projectLinks()).toHaveLength(10);
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: 'Previous' }));
    expect(screen.getByText('Page 2 of 3')).toBeInTheDocument();
  });

  it.each([
    ['10', 10, 'Page 1 of 6'],
    ['50', 50, 'Page 1 of 2'],
  ])('changing the page size to %s shows %i rows and returns to page 1', async (size, rows, label) => {
    renderList({ projects: makeProjects(60) });
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Projects per page' }), size);
    expect(projectLinks()).toHaveLength(rows);
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it('hides pagination when everything fits on one page', async () => {
    renderList({ projects: makeProjects(60) });
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Projects per page' }), '100');
    expect(projectLinks()).toHaveLength(60);
    expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument();
  });

  it('changing the filter returns to page 1', async () => {
    renderList({ projects: makeProjects(90) }); // 30 of each health
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('Page 3 of 4')).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /budget health/ }), 'on_track');
    expect(screen.getByText('Page 1 of 2')).toBeInTheDocument();
    expect(projectLinks()[0]).toBe('Project 1');
  });
});
