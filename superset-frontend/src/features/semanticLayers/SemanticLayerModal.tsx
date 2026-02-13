/**
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { t } from '@apache-superset/core';
import { styled } from '@apache-superset/core/ui';
import { SupersetClient } from '@superset-ui/core';
import { Select } from '@superset-ui/core/components';
import { Icons } from '@superset-ui/core/components/Icons';
import { JsonForms } from '@jsonforms/react';
import type { JsonSchema, UISchemaElement } from '@jsonforms/core';
import {
  rendererRegistryEntries,
  cellRegistryEntries,
} from '@great-expectations/jsonforms-antd-renderers';
import type { ErrorObject } from 'ajv';
import {
  StandardModal,
  ModalFormField,
  MODAL_STANDARD_WIDTH,
  MODAL_MEDIUM_WIDTH,
} from 'src/components/Modal';

type Step = 'type' | 'config';
type ValidationMode = 'ValidateAndHide' | 'ValidateAndShow';

/**
 * Removes empty `enum` arrays from schema properties. The JSON Schema spec
 * requires `enum` to have at least one item, and AJV rejects empty arrays.
 * Fields with empty enums are rendered as plain text inputs instead.
 */
function sanitizeSchema(schema: JsonSchema): JsonSchema {
  if (!schema.properties) return schema;
  const properties: Record<string, JsonSchema> = {};
  for (const [key, prop] of Object.entries(schema.properties)) {
    if (
      typeof prop === 'object' &&
      prop !== null &&
      'enum' in prop &&
      Array.isArray(prop.enum) &&
      prop.enum.length === 0
    ) {
      const { enum: _empty, ...rest } = prop;
      properties[key] = rest;
    } else {
      properties[key] = prop as JsonSchema;
    }
  }
  return { ...schema, properties };
}

/**
 * Builds a JSON Forms UI schema from a JSON Schema, using the first
 * `examples` entry as placeholder text for each string property.
 */
function buildUiSchema(
  schema: JsonSchema,
): UISchemaElement | undefined {
  if (!schema.properties) return undefined;

  // Use explicit property order from backend if available,
  // otherwise fall back to the JSON object key order
  const propertyOrder: string[] =
    (schema as Record<string, unknown>)['x-propertyOrder'] as string[] ??
    Object.keys(schema.properties);

  const elements = propertyOrder
    .filter(key => key in (schema.properties ?? {}))
    .map(key => {
      const prop = schema.properties![key];
      const control: Record<string, unknown> = {
        type: 'Control',
        scope: `#/properties/${key}`,
      };
      if (typeof prop === 'object' && prop !== null) {
        const options: Record<string, unknown> = {};
        if (
          'examples' in prop &&
          Array.isArray(prop.examples) &&
          prop.examples.length > 0
        ) {
          options.placeholderText = String(prop.examples[0]);
        }
        if ('description' in prop && typeof prop.description === 'string') {
          options.tooltip = prop.description;
        }
        if (Object.keys(options).length > 0) {
          control.options = options;
        }
      }
      return control;
    });
  return { type: 'VerticalLayout', elements } as UISchemaElement;
}

const ModalContent = styled.div`
  padding: ${({ theme }) => theme.sizeUnit * 4}px;
`;

const BackLink = styled.button`
  background: none;
  border: none;
  color: ${({ theme }) => theme.colorPrimary};
  cursor: pointer;
  padding: 0;
  font-size: ${({ theme }) => theme.fontSize[1]}px;
  margin-bottom: ${({ theme }) => theme.sizeUnit * 2}px;
  display: inline-flex;
  align-items: center;
  gap: ${({ theme }) => theme.sizeUnit}px;

  &:hover {
    text-decoration: underline;
  }
`;

interface SemanticLayerType {
  id: string;
  name: string;
  description: string;
}

interface SemanticLayerModalProps {
  show: boolean;
  onHide: () => void;
  addDangerToast: (msg: string) => void;
  addSuccessToast: (msg: string) => void;
}

export default function SemanticLayerModal({
  show,
  onHide,
  addDangerToast,
  addSuccessToast,
}: SemanticLayerModalProps) {
  const [step, setStep] = useState<Step>('type');
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [types, setTypes] = useState<SemanticLayerType[]>([]);
  const [loading, setLoading] = useState(false);
  const [configSchema, setConfigSchema] = useState<JsonSchema | null>(null);
  const [uiSchema, setUiSchema] = useState<UISchemaElement | undefined>(
    undefined,
  );
  const [formData, setFormData] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);
  const [validationMode, setValidationMode] =
    useState<ValidationMode>('ValidateAndHide');
  const errorsRef = useRef<ErrorObject[]>([]);

  const fetchTypes = useCallback(async () => {
    setLoading(true);
    try {
      const { json } = await SupersetClient.get({
        endpoint: '/api/v1/semantic_layer/types',
      });
      setTypes(json.result ?? []);
    } catch {
      addDangerToast(
        t('An error occurred while fetching semantic layer types'),
      );
    } finally {
      setLoading(false);
    }
  }, [addDangerToast]);

  const fetchConfigSchema = useCallback(
    async (type: string) => {
      setLoading(true);
      try {
        const { json } = await SupersetClient.post({
          endpoint: '/api/v1/semantic_layer/schema/configuration',
          jsonPayload: { type },
        });
        const schema: JsonSchema = sanitizeSchema(json.result);
        setConfigSchema(schema);
        setUiSchema(buildUiSchema(schema));
        setStep('config');
      } catch {
        addDangerToast(
          t('An error occurred while fetching the configuration schema'),
        );
      } finally {
        setLoading(false);
      }
    },
    [addDangerToast],
  );

  useEffect(() => {
    if (show) {
      fetchTypes();
    } else {
      setStep('type');
      setSelectedType(null);
      setTypes([]);
      setConfigSchema(null);
      setUiSchema(undefined);
      setFormData({});
      setValidationMode('ValidateAndHide');
      errorsRef.current = [];
    }
  }, [show, fetchTypes]);

  const handleStepAdvance = () => {
    if (selectedType) {
      fetchConfigSchema(selectedType);
    }
  };

  const handleBack = () => {
    setStep('type');
    setConfigSchema(null);
    setUiSchema(undefined);
    setFormData({});
    setValidationMode('ValidateAndHide');
    errorsRef.current = [];
  };

  const handleCreate = async () => {
    setSaving(true);
    try {
      await SupersetClient.post({
        endpoint: '/api/v1/semantic_layer/',
        jsonPayload: { type: selectedType, configuration: formData },
      });
      addSuccessToast(t('Semantic layer created'));
      onHide();
    } catch {
      addDangerToast(t('An error occurred while creating the semantic layer'));
    } finally {
      setSaving(false);
    }
  };

  const handleSave = () => {
    if (step === 'type') {
      handleStepAdvance();
    } else {
      setValidationMode('ValidateAndShow');
      if (errorsRef.current.length === 0) {
        handleCreate();
      }
    }
  };

  const handleFormChange = ({
    data,
    errors,
  }: {
    data: Record<string, unknown>;
    errors?: ErrorObject[];
  }) => {
    setFormData(data);
    errorsRef.current = errors ?? [];
    if (
      validationMode === 'ValidateAndShow' &&
      errorsRef.current.length === 0
    ) {
      handleCreate();
    }
  };

  const selectedTypeName =
    types.find(type => type.id === selectedType)?.name ?? '';

  const title =
    step === 'type'
      ? t('New Semantic Layer')
      : t('Configure %s', selectedTypeName);

  return (
    <StandardModal
      show={show}
      onHide={onHide}
      onSave={handleSave}
      title={title}
      icon={<Icons.PlusOutlined />}
      width={step === 'type' ? MODAL_STANDARD_WIDTH : MODAL_MEDIUM_WIDTH}
      saveDisabled={step === 'type' ? !selectedType : saving}
      saveText={step === 'type' ? undefined : t('Create')}
      saveLoading={saving}
      contentLoading={loading}
    >
      {step === 'type' ? (
        <ModalContent>
          <ModalFormField label={t('Type')}>
            <Select
              ariaLabel={t('Semantic layer type')}
              placeholder={t('Select a semantic layer type')}
              value={selectedType}
              onChange={value => setSelectedType(value as string)}
              options={types.map(type => ({
                value: type.id,
                label: type.name,
              }))}
              getPopupContainer={() => document.body}
              dropdownAlign={{
                points: ['tl', 'bl'],
                offset: [0, 4],
                overflow: { adjustX: 0, adjustY: 1 },
              }}
            />
          </ModalFormField>
        </ModalContent>
      ) : (
        <ModalContent>
          <BackLink type="button" onClick={handleBack}>
            <Icons.CaretLeftOutlined iconSize="s" />
            {t('Back')}
          </BackLink>
          {configSchema && (
            <JsonForms
              schema={configSchema}
              uischema={uiSchema}
              data={formData}
              renderers={rendererRegistryEntries}
              cells={cellRegistryEntries}
              validationMode={validationMode}
              onChange={handleFormChange}
            />
          )}
        </ModalContent>
      )}
    </StandardModal>
  );
}
