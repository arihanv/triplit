import { TriplitClient } from '@triplit/client';
import { useQuery } from '@triplit/react';
import { useMemo, useState, useCallback } from 'react';
import '@glideapps/glide-data-grid/dist/index.css';
import { Modal } from '@/components/ui/modal.js';
import { CreateEntityForm } from '.';
import { consoleClient } from '../../triplit/client';
import { ColumnDef } from '@tanstack/react-table';
import {
  DataTable,
  DataCell,
  TriplitColumnHeader,
  RelationCell,
} from './data-table';
import { Button } from '@/components/ui/button';
import {
  NewAttributeForm,
  addOrUpdateAttributeFormOpenAtom,
  attributeToUpdateAtom,
} from './new-attribute-form';
import { ColumnMenu } from './column-menu';
import { DeleteAttributeDialog } from './delete-attribute-dialog';
import { atom, useAtom } from 'jotai';
import { FiltersPopover } from './filters-popover';
import { OrderPopover } from './order-popover';
import { Checkbox } from '../../@/components/ui/checkbox';
import { Tooltip } from '../../@/components/ui/tooltip-simple';
import { Trash } from '@phosphor-icons/react';
import { useSelectedCollection } from '../hooks/useSelectedCollection';
import { SchemaDefinition } from '../../../db/src/data-types/serialization';
import useUrlState from '@ahooksjs/use-url-state';

const deleteAttributeDialogIsOpenAtom = atom(false);

window.client = consoleClient;

async function onSelectEntity(
  entityId: string,
  collectionName: string,
  projectId: string
) {
  await consoleClient.insert('selections', {
    collectionName,
    projectId,
    id: entityId,
  });
}
async function onDeselectEntity(entityId: string) {
  await consoleClient.delete('selections', entityId);
}

async function onDeselectAllEntities(
  collectionName: string,
  projectId: string
) {
  await consoleClient.transact(async (tx) => {
    const selectedEntities = await consoleClient.fetch(
      consoleClient
        .query('selections')
        .where([
          ['collectionName', '=', collectionName],
          ['projectId', '=', projectId],
        ])
        .build()
    );
    await Promise.all(
      Array.from(selectedEntities.keys()).map((selectedEnt) =>
        tx.delete('selections', selectedEnt)
      )
    );
  });
}

async function onSelectAllEntities(
  entityIds: string[],
  collectionName: string,
  projectId: string
) {
  await consoleClient.transact(async (tx) => {
    await Promise.all(
      entityIds.map((entityId) =>
        tx.insert('selections', { collectionName, projectId, id: entityId })
      )
    );
  });
}

async function deleteEntities(
  client: TriplitClient<any>,
  collectionName: string,
  ids: string[]
) {
  await client.transact(async (tx) => {
    await Promise.all(ids.map((id) => tx.delete(collectionName, id)));
  });
  await consoleClient.transact(async (tx) => {
    await Promise.all(ids.map((id) => tx.delete('selections', id)));
  });
}

async function deleteAttribute(
  client: TriplitClient<any>,
  collectionName: string,
  attributeName: string
) {
  try {
    await client.db.dropAttribute({
      collection: collectionName,
      path: [attributeName],
    });
  } catch (e) {
    console.error(e);
  }
}

export function DataViewer({
  collection,
  client,
  schema,
  projectId,
}: {
  projectId: string;
  collection: string;
  client: TriplitClient<any>;
  schema?: SchemaDefinition;
}) {
  const [deleteAttributeDialogIsOpen, setDeleteAttributeDialogIsOpen] = useAtom(
    deleteAttributeDialogIsOpenAtom
  );
  const [addOrUpdateAttributeFormOpen, setAddOrUpdateAttributeFormOpen] =
    useAtom(addOrUpdateAttributeFormOpenAtom);
  const [_attributeToUpdate, setAttributeToUpdate] = useAtom(
    attributeToUpdateAtom
  );
  const [selectedAttribute, setSelectedAttribute] = useState<string>('');
  const [selectedCell, setSelectedCell] = useState<string | null>(null);
  const [selectedCollection, setSelectedCollection] = useSelectedCollection();
  const [urlQueryState, setUrlQueryState] = useUrlState({
    where: undefined,
    order: undefined,
  });
  const { results: selectedEntities } = useQuery(
    consoleClient,
    consoleClient.query('selections').where([
      ['collectionName', '=', collection],
      ['projectId', '=', projectId],
    ])
  );
  const [createEntityModalIsOpen, setCreateEntityModalIsOpen] = useState(false);

  const collectionSchema = schema?.collections?.[selectedCollection];
  const filters = JSON.parse(urlQueryState.where ?? '[]');
  const order = JSON.parse(urlQueryState.order ?? '[]');

  const { results: orderedAndFilteredResults } = useQuery(
    client,
    client
      .query(collection)
      .order(...order)
      .where(filters)
  );

  const { results: allResults } = useQuery(client, client.query(collection));
  const sortedAndFilteredEntities = useMemo(
    () => Array.from(orderedAndFilteredResults ?? []),
    [orderedAndFilteredResults]
  );

  const uniqueAttributes: Set<string> = useMemo(() => {
    const attributes = new Set<string>();
    // if we have a schema, use it
    if (collectionSchema) {
      // handle the case where we have a collection but no attributes
      return new Set(Object.keys(collectionSchema.schema.properties ?? {}));
    }
    if (!allResults) return attributes;
    // otherwise construct a set of all attributes from all entities
    allResults.forEach((data) => {
      Object.keys(data).forEach((key: string) => {
        if (!attributes.has(key) && key !== '_collection') {
          attributes.add(key);
        }
      });
    });

    return attributes;
  }, [allResults, collectionSchema]);

  const allVisibleEntitiesAreSelected = useMemo(() => {
    if (!selectedEntities || selectedEntities.size === 0) return false;
    const allVisibleEntities = new Set(
      sortedAndFilteredEntities.map(([id]) => id)
    );
    return Array.from(allVisibleEntities).every((id) =>
      selectedEntities.has(id)
    );
  }, [sortedAndFilteredEntities, selectedEntities]);

  const toggleSelectAllEntities = useCallback(() => {
    allVisibleEntitiesAreSelected
      ? onDeselectAllEntities(collection, projectId)
      : onSelectAllEntities(
          sortedAndFilteredEntities.map(([id]) => id),
          collection,
          projectId
        );
  }, [
    sortedAndFilteredEntities,
    collection,
    projectId,
    allVisibleEntitiesAreSelected,
  ]);

  const idColumn: ColumnDef<any> = useMemo(
    () => ({
      header: () => <TriplitColumnHeader attribute="id" />,
      cell: ({ row }) => (
        <DataCell
          attribute="id"
          value={row.getValue('id')}
          entityId={row.getValue('id')}
        />
      ),
      accessorKey: 'id',
    }),
    []
  );

  const selectEntitiesColumn: ColumnDef<any> = useMemo(
    () => ({
      header: () => (
        <Tooltip label="Select all">
          <Checkbox
            className="mx-3"
            checked={allVisibleEntitiesAreSelected}
            onCheckedChange={toggleSelectAllEntities}
          />
        </Tooltip>
      ),
      cell: ({ row }) => {
        const entityId = row.getValue('id');
        return (
          <Checkbox
            className="mx-3"
            checked={selectedEntities && selectedEntities.has(entityId)}
            onCheckedChange={(checked) => {
              checked
                ? onSelectEntity(entityId, collection, projectId)
                : onDeselectEntity(entityId);
            }}
          />
        );
      },
      accessorKey: 'checkbox',
    }),
    [
      allVisibleEntitiesAreSelected,
      collection,
      projectId,
      toggleSelectAllEntities,
      selectedEntities,
    ]
  );
  console.log('uniqueAttributes', uniqueAttributes);
  const columns = useMemo(() => {
    const cols: ColumnDef<any>[] = [selectEntitiesColumn, idColumn];
    Array.from(uniqueAttributes)
      .filter((attr) => attr !== 'id')
      .forEach((attr) => {
        const typeDef = collectionSchema?.schema?.properties?.[attr];
        const isQueryColumn = typeDef?.type === 'query';
        cols.push({
          cell: ({ row, column }) => {
            const cellKey = `${row.getValue('id')}_${column.id}`;
            if (isQueryColumn)
              return (
                <RelationCell
                  queryDef={typeDef}
                  onClickRelationLink={() => {
                    const where = typeDef?.query?.where;
                    const whereWithVariablesReplaced = where.map(
                      ([attribute, operator, value]) => {
                        if (typeof value === 'string' && value.startsWith('$'))
                          value = row.getValue(value.split('$')[1] as string);
                        return [attribute, operator, value];
                      }
                    );
                    setUrlQueryState({
                      where: JSON.stringify(whereWithVariablesReplaced),
                      collectionName: typeDef?.query?.collectionName,
                    });
                  }}
                />
              );
            return (
              <DataCell
                attributeDef={typeDef}
                selected={selectedCell === cellKey}
                onSelectCell={() => setSelectedCell(cellKey)}
                attribute={attr}
                collection={collection}
                entityId={row.getValue('id')}
                client={client}
                value={row.getValue(attr)}
              />
            );
          },
          header: ({ column }) => {
            return (
              <TriplitColumnHeader
                attribute={attr}
                attributeDef={typeDef}
                rightIcon={
                  typeDef && (
                    <ColumnMenu
                      onDelete={() => {
                        setDeleteAttributeDialogIsOpen(true);
                        setSelectedAttribute(attr);
                      }}
                      onEdit={() => {
                        setAddOrUpdateAttributeFormOpen(true);
                        setAttributeToUpdate({
                          name: attr,
                          ...collectionSchema?.schema?.properties?.[attr],
                        });
                      }}
                    />
                  )
                }
              />
            );
          },
          accessorKey: attr,
        });
      });
    return cols;
  }, [
    uniqueAttributes,
    collectionSchema,
    selectedCell,
    toggleSelectAllEntities,
    selectEntitiesColumn,
    idColumn,
  ]);

  const createNewEntity = useCallback(
    async (entity: any, id: string) => {
      try {
        await client.insert(collection, entity, id !== '' ? id : undefined);
        setCreateEntityModalIsOpen(false);
      } catch (e) {
        console.error(e);
      }
    },
    [client, collection]
  );

  const flatFilteredEntities = useMemo(
    () => sortedAndFilteredEntities.map(([id, entity]) => ({ id, ...entity })),
    [sortedAndFilteredEntities]
  );

  return (
    <div className="flex flex-col w-full h-full">
      <Modal
        open={createEntityModalIsOpen}
        onOpenChange={setCreateEntityModalIsOpen}
        title={`Create new entity`}
      >
        <CreateEntityForm
          collectionDefinition={collectionSchema}
          collection={collection}
          inferredAttributes={Array.from(uniqueAttributes)}
          onCreate={createNewEntity}
          onCancel={() => setCreateEntityModalIsOpen(false)}
        />
      </Modal>
      <NewAttributeForm
        open={addOrUpdateAttributeFormOpen}
        onOpenChange={setAddOrUpdateAttributeFormOpen}
        collectionName={collection}
        client={client}
        collectionSchema={collectionSchema}
      />
      <DeleteAttributeDialog
        collectionName={collection}
        attributeName={selectedAttribute}
        open={deleteAttributeDialogIsOpen}
        onOpenChange={(open) => {
          setDeleteAttributeDialogIsOpen(open);
          if (!open) setSelectedAttribute('');
        }}
        onSubmit={async () => {
          await deleteAttribute(client, collection, selectedAttribute);
          setDeleteAttributeDialogIsOpen(false);
        }}
      />
      <div className="flex flex-row gap-3 p-4 items-center border-b">
        <FiltersPopover
          filters={filters}
          uniqueAttributes={uniqueAttributes}
          projectId={projectId}
          collection={collection}
          collectionSchema={collectionSchema}
          onSubmit={(filters) => {
            setUrlQueryState({ where: JSON.stringify(filters) });
          }}
        />

        <Button size={'sm'} variant={'secondary'}>{`Showing ${
          sortedAndFilteredEntities.length
        } of ${allResults?.size ?? 0}`}</Button>
        <OrderPopover
          uniqueAttributes={uniqueAttributes}
          collection={collection}
          collectionSchema={collectionSchema}
          order={order}
          onSubmit={(order) => {
            setUrlQueryState({ order: JSON.stringify(order) });
          }}
        />
        <Button
          size={'sm'}
          variant={'secondary'}
          onClick={() => setCreateEntityModalIsOpen(true)}
        >
          Add entity
        </Button>
        {selectedEntities && selectedEntities.size > 0 && (
          <Button
            size={'sm'}
            variant={'destructive'}
            onClick={async () => {
              await deleteEntities(
                client,
                collection,
                Array.from(selectedEntities.keys())
              );
            }}
          >
            <Trash className=" mr-2" />
            Delete selected entities
          </Button>
        )}
        {collectionSchema && (
          <Button
            size={'sm'}
            variant={'secondary'}
            onClick={() => setAddOrUpdateAttributeFormOpen(true)}
          >
            New attribute
          </Button>
        )}
      </div>
      <DataTable columns={columns} data={flatFilteredEntities} />
    </div>
  );
}