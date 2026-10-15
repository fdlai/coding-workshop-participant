import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  Button,
  ConfirmDialog,
  DataTable,
  Field,
  FilterBar,
  FormModal,
  Modal,
  Pagination,
  SelectInput,
  TextArea,
  TextInput,
} from '../Controls';

describe('Button', () => {
  it('defaults to a non-submitting button and forwards props', async () => {
    const onClick = jest.fn();
    render(<Button onClick={onClick} className="extra">Save</Button>);
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button).toHaveAttribute('type', 'button');
    expect(button).toHaveClass('bg-indigo-600', 'px-4', 'extra');
    await userEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('supports variants, small size and disabling', async () => {
    const onClick = jest.fn();
    render(<Button variant="danger" size="sm" disabled onClick={onClick}>Delete</Button>);
    const button = screen.getByRole('button', { name: 'Delete' });
    expect(button).toHaveClass('bg-red-600', 'px-2.5');
    expect(button).toBeDisabled();
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe('form controls', () => {
  it('labels controls and shows hints', async () => {
    render(
      <FilterBar>
        <Field label="Name" htmlFor="n" hint="Your full name"><TextInput id="n" /></Field>
        <Field label="Role" htmlFor="r">
          <SelectInput id="r" defaultValue="employee">
            <option value="employee">Employee</option>
            <option value="manager">Manager</option>
          </SelectInput>
        </Field>
        <Field label="Notes" htmlFor="t"><TextArea id="t" /></Field>
      </FilterBar>,
    );
    await userEvent.type(screen.getByLabelText('Name'), 'Ada');
    expect(screen.getByLabelText('Name')).toHaveValue('Ada');
    expect(screen.getByText('Your full name')).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Role'), 'manager');
    expect(screen.getByLabelText('Role')).toHaveValue('manager');
    expect(screen.getByLabelText('Notes')).toHaveAttribute('rows', '3');
  });
});

describe('Modal', () => {
  it('renders an accessible dialog that closes with the button or Escape', async () => {
    const onClose = jest.fn();
    render(<Modal title="Edit project" onClose={onClose}><p>Body</p></Modal>);
    expect(screen.getByRole('dialog', { name: 'Edit project' })).toBeInTheDocument();
    expect(screen.getByText('Body')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(2);
    await userEvent.keyboard('a');
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('stops listening for Escape once closed', async () => {
    const onClose = jest.fn();
    const { unmount } = render(<Modal title="X" onClose={onClose} wide />);
    unmount();
    await userEvent.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('FormModal', () => {
  it('submits, shows a busy state and closes with success', async () => {
    let finish;
    const onSubmit = jest.fn(() => new Promise((resolve) => { finish = resolve; }));
    const onClose = jest.fn();
    render(<FormModal title="New project" onClose={onClose} onSubmit={onSubmit} submitLabel="Create"><input aria-label="Name" /></FormModal>);

    await userEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(screen.getByRole('button', { name: 'Working…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    finish();
    await waitFor(() => expect(onClose).toHaveBeenCalledWith(true));
  });

  it('shows the API error and re-enables the form when submit fails', async () => {
    const onClose = jest.fn();
    render(<FormModal title="New" onClose={onClose} onSubmit={() => Promise.reject(new Error('Name already taken'))} />);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Name already taken');
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('cancels without saving via Cancel or the close button', async () => {
    const onClose = jest.fn();
    const onSubmit = jest.fn();
    render(<FormModal title="New" onClose={onClose} onSubmit={onSubmit} />);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenNthCalledWith(1, false);
    expect(onClose).toHaveBeenNthCalledWith(2, false);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe('ConfirmDialog', () => {
  it('shows the message and confirms with a danger button by default', async () => {
    const onConfirm = jest.fn().mockResolvedValue();
    const onClose = jest.fn();
    render(<ConfirmDialog title="Archive project?" message="It becomes read-only." confirmLabel="Archive" onConfirm={onConfirm} onClose={onClose} />);
    expect(screen.getByText('It becomes read-only.')).toBeInTheDocument();
    const confirm = screen.getByRole('button', { name: 'Archive' });
    expect(confirm).toHaveClass('bg-red-600');
    await userEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(onClose).toHaveBeenCalledWith(true));
  });

  it('can use a non-danger confirm button', () => {
    render(<ConfirmDialog title="Restore?" message="Restore it." danger={false} onConfirm={jest.fn()} onClose={jest.fn()} />);
    expect(screen.getByRole('button', { name: 'Confirm' })).toHaveClass('bg-indigo-600');
  });
});

describe('Pagination', () => {
  it('renders nothing when everything fits on one page', () => {
    const { container } = render(<Pagination offset={0} limit={20} total={20} onChange={jest.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the range and moves between pages', async () => {
    const onChange = jest.fn();
    const { rerender } = render(<Pagination offset={0} limit={20} total={45} onChange={onChange} />);
    expect(screen.getByText('Showing 1–20 of 45')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(onChange).toHaveBeenLastCalledWith(20);

    rerender(<Pagination offset={40} limit={20} total={45} onChange={onChange} />);
    expect(screen.getByText('Showing 41–45 of 45')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Previous' }));
    expect(onChange).toHaveBeenLastCalledWith(20);
  });

  it('never goes below offset 0', async () => {
    const onChange = jest.fn();
    render(<Pagination offset={5} limit={20} total={45} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Previous' }));
    expect(onChange).toHaveBeenCalledWith(0);
  });
});

describe('DataTable', () => {
  const columns = [
    { key: 'name', header: 'Name' },
    { key: 'role', header: 'Role', render: (row) => row.role.toUpperCase() },
  ];
  const rows = [{ id: 1, name: 'Ada', role: 'admin' }, { id: 2, name: 'Max', role: 'manager' }];

  it('renders headers and cells, using custom renderers', () => {
    render(<DataTable columns={columns} rows={rows} />);
    expect(screen.getAllByRole('columnheader').map((th) => th.textContent)).toEqual(['Name', 'Role']);
    const cells = screen.getAllByRole('row').slice(1).map((tr) => tr.textContent);
    expect(cells).toEqual(['AdaADMIN', 'MaxMANAGER']);
    expect(screen.getAllByRole('row')[1]).not.toHaveClass('cursor-pointer');
  });

  it('makes rows clickable and supports a custom key', async () => {
    const onRowClick = jest.fn();
    render(<DataTable columns={columns} rows={rows.map((r) => ({ ...r, key: `k${r.id}` }))} rowKey="key" onRowClick={onRowClick} />);
    await userEvent.click(screen.getByText('Max'));
    expect(onRowClick).toHaveBeenCalledWith(expect.objectContaining({ id: 2 }));
    expect(screen.getAllByRole('row')[1]).toHaveClass('cursor-pointer');
  });
});
