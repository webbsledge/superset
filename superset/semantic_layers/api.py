# Licensed to the Apache Software Foundation (ASF) under one
# or more contributor license agreements.  See the NOTICE file
# distributed with this work for additional information
# regarding copyright ownership.  The ASF licenses this file
# to you under the Apache License, Version 2.0 (the
# "License"); you may not use this file except in compliance
# with the License.  You may obtain a copy of the License at
#
#   http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing,
# software distributed under the License is distributed on an
# "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
# KIND, either express or implied.  See the License for the
# specific language governing permissions and limitations
# under the License.
from __future__ import annotations

import json
import logging
from typing import Any

from flask import make_response, request, Response
from flask_appbuilder.api import expose, protect, safe
from flask_appbuilder.models.sqla.interface import SQLAInterface
from marshmallow import ValidationError
from pydantic import ValidationError as PydanticValidationError

from superset import event_logger
from superset.commands.semantic_layer.create import CreateSemanticLayerCommand
from superset.commands.semantic_layer.delete import DeleteSemanticLayerCommand
from superset.commands.semantic_layer.exceptions import (
    SemanticLayerCreateFailedError,
    SemanticLayerDeleteFailedError,
    SemanticLayerInvalidError,
    SemanticLayerNotFoundError,
    SemanticLayerUpdateFailedError,
    SemanticViewForbiddenError,
    SemanticViewInvalidError,
    SemanticViewNotFoundError,
    SemanticViewUpdateFailedError,
)
from superset.commands.semantic_layer.update import (
    UpdateSemanticLayerCommand,
    UpdateSemanticViewCommand,
)
from superset.constants import MODEL_API_RW_METHOD_PERMISSION_MAP
from superset.daos.semantic_layer import SemanticLayerDAO
from superset.semantic_layers.models import SemanticLayer, SemanticView
from superset.semantic_layers.registry import registry
from superset.semantic_layers.schemas import (
    SemanticLayerPostSchema,
    SemanticLayerPutSchema,
    SemanticViewPutSchema,
)
from superset.superset_typing import FlaskResponse
from superset.views.base_api import (
    BaseSupersetApi,
    BaseSupersetModelRestApi,
    requires_json,
    statsd_metrics,
)

logger = logging.getLogger(__name__)


def _serialize_layer(layer: SemanticLayer) -> dict[str, Any]:
    return {
        "uuid": str(layer.uuid),
        "name": layer.name,
        "description": layer.description,
        "type": layer.type,
        "cache_timeout": layer.cache_timeout,
    }


def _infer_discriminators(
    schema: dict[str, Any],
    data: dict[str, Any],
) -> dict[str, Any]:
    """
    Infer discriminator values for union fields when the frontend omits them.

    Walks the schema's properties looking for discriminated unions (fields with a
    ``discriminator.mapping``). For each one, tries to match the submitted data
    against one of the variants by checking which variant's required fields are
    present, then injects the discriminator value.
    """
    defs = schema.get("$defs", {})
    for prop_name, prop_schema in schema.get("properties", {}).items():
        value = data.get(prop_name)
        if not isinstance(value, dict):
            continue

        # Find discriminated union via discriminator mapping
        mapping = (
            prop_schema.get("discriminator", {}).get("mapping")
            if "discriminator" in prop_schema
            else None
        )
        if not mapping:
            continue

        discriminator_field = prop_schema["discriminator"].get("propertyName")
        if not discriminator_field or discriminator_field in value:
            continue

        # Try each variant: match by required fields present in the data
        for disc_value, ref in mapping.items():
            ref_name = ref.rsplit("/", 1)[-1] if "/" in ref else ref
            variant_def = defs.get(ref_name, {})
            required = set(variant_def.get("required", []))
            # Exclude the discriminator itself from the check
            required.discard(discriminator_field)
            if required and required.issubset(value.keys()):
                data = {
                    **data,
                    prop_name: {**value, discriminator_field: disc_value},
                }
                break

    return data


def _parse_partial_config(
    cls: Any,
    config: dict[str, Any],
) -> Any:
    """
    Parse a partial configuration, handling discriminator inference and
    falling back to lenient validation when strict parsing fails.
    """
    config_class = cls.configuration_class

    # Infer discriminator values the frontend may have omitted
    schema = config_class.model_json_schema()
    config = _infer_discriminators(schema, config)

    try:
        return config_class.model_validate(config)
    except (PydanticValidationError, ValueError):
        pass

    try:
        return config_class.model_validate(config, context={"partial": True})
    except (PydanticValidationError, ValueError):
        return None


class SemanticViewRestApi(BaseSupersetModelRestApi):
    datamodel = SQLAInterface(SemanticView)

    resource_name = "semantic_view"
    allow_browser_login = True
    class_permission_name = "SemanticView"
    method_permission_name = MODEL_API_RW_METHOD_PERMISSION_MAP
    include_route_methods = {"put"}

    edit_model_schema = SemanticViewPutSchema()

    @expose("/<pk>", methods=("PUT",))
    @protect()
    @statsd_metrics
    @event_logger.log_this_with_context(
        action=lambda self, *args, **kwargs: f"{self.__class__.__name__}.put",
        log_to_statsd=False,
    )
    @requires_json
    def put(self, pk: int) -> Response:
        """Update a semantic view.
        ---
        put:
          summary: Update a semantic view
          parameters:
          - in: path
            schema:
              type: integer
            name: pk
          requestBody:
            description: Semantic view schema
            required: true
            content:
              application/json:
                schema:
                  $ref: '#/components/schemas/{{self.__class__.__name__}}.put'
          responses:
            200:
              description: Semantic view changed
              content:
                application/json:
                  schema:
                    type: object
                    properties:
                      id:
                        type: number
                      result:
                        $ref: '#/components/schemas/{{self.__class__.__name__}}.put'
            400:
              $ref: '#/components/responses/400'
            401:
              $ref: '#/components/responses/401'
            403:
              $ref: '#/components/responses/403'
            404:
              $ref: '#/components/responses/404'
            422:
              $ref: '#/components/responses/422'
            500:
              $ref: '#/components/responses/500'
        """
        try:
            item = self.edit_model_schema.load(request.json)
        except ValidationError as error:
            return self.response_400(message=error.messages)
        try:
            changed_model = UpdateSemanticViewCommand(pk, item).run()
            response = self.response(200, id=changed_model.id, result=item)
        except SemanticViewNotFoundError:
            response = self.response_404()
        except SemanticViewForbiddenError:
            response = self.response_403()
        except SemanticViewInvalidError as ex:
            response = self.response_422(message=ex.normalized_messages())
        except SemanticViewUpdateFailedError as ex:
            logger.error(
                "Error updating model %s: %s",
                self.__class__.__name__,
                str(ex),
                exc_info=True,
            )
            response = self.response_422(message=str(ex))
        return response


class SemanticLayerRestApi(BaseSupersetApi):
    resource_name = "semantic_layer"
    allow_browser_login = True
    class_permission_name = "SemanticLayer"
    method_permission_name = MODEL_API_RW_METHOD_PERMISSION_MAP
    openapi_spec_tag = "Semantic Layers"

    @expose("/types", methods=("GET",))
    @protect()
    @safe
    @statsd_metrics
    def types(self) -> FlaskResponse:
        """List available semantic layer types.
        ---
        get:
          summary: List available semantic layer types
          responses:
            200:
              description: A list of semantic layer types
            401:
              $ref: '#/components/responses/401'
        """
        result = [
            {"id": key, "name": cls.name, "description": cls.description}
            for key, cls in registry.items()
        ]
        return self.response(200, result=result)

    @expose("/schema/configuration", methods=("POST",))
    @protect()
    @safe
    @statsd_metrics
    @requires_json
    def configuration_schema(self) -> FlaskResponse:
        """Get configuration schema for a semantic layer type.
        ---
        post:
          summary: Get configuration schema for a semantic layer type
          requestBody:
            required: true
            content:
              application/json:
                schema:
                  type: object
                  properties:
                    type:
                      type: string
                    configuration:
                      type: object
          responses:
            200:
              description: Configuration JSON Schema
            400:
              $ref: '#/components/responses/400'
            401:
              $ref: '#/components/responses/401'
        """
        body = request.json or {}
        sl_type = body.get("type")

        cls = registry.get(sl_type)
        if not cls:
            return self.response_400(message=f"Unknown type: {sl_type}")

        parsed_config = None
        if config := body.get("configuration"):
            parsed_config = _parse_partial_config(cls, config)

        try:
            schema = cls.get_configuration_schema(parsed_config)
        except Exception:  # pylint: disable=broad-except
            # Connection or query failures during schema enrichment should not
            # prevent the form from rendering — return the base schema instead.
            schema = cls.get_configuration_schema(None)

        resp = make_response(json.dumps({"result": schema}, sort_keys=False), 200)
        resp.headers["Content-Type"] = "application/json; charset=utf-8"
        return resp

    @expose("/<uuid>/schema/runtime", methods=("POST",))
    @protect()
    @safe
    @statsd_metrics
    def runtime_schema(self, uuid: str) -> FlaskResponse:
        """Get runtime schema for a stored semantic layer.
        ---
        post:
          summary: Get runtime schema for a semantic layer
          parameters:
          - in: path
            schema:
              type: string
            name: uuid
          requestBody:
            content:
              application/json:
                schema:
                  type: object
                  properties:
                    runtime_data:
                      type: object
          responses:
            200:
              description: Runtime JSON Schema
            401:
              $ref: '#/components/responses/401'
            404:
              $ref: '#/components/responses/404'
        """
        layer = SemanticLayerDAO.find_by_uuid(uuid)
        if not layer:
            return self.response_404()

        body = request.get_json(silent=True) or {}
        runtime_data = body.get("runtime_data")

        cls = registry.get(layer.type)
        if not cls:
            return self.response_400(message=f"Unknown type: {layer.type}")

        try:
            schema = cls.get_runtime_schema(
                layer.implementation.configuration, runtime_data
            )
        except Exception as ex:  # pylint: disable=broad-except
            return self.response_400(message=str(ex))

        return self.response(200, result=schema)

    @expose("/", methods=("POST",))
    @protect()
    @safe
    @statsd_metrics
    @requires_json
    def post(self) -> FlaskResponse:
        """Create a semantic layer.
        ---
        post:
          summary: Create a semantic layer
          requestBody:
            required: true
            content:
              application/json:
                schema:
                  type: object
                  properties:
                    name:
                      type: string
                    description:
                      type: string
                    type:
                      type: string
                    configuration:
                      type: object
                    cache_timeout:
                      type: integer
          responses:
            201:
              description: Semantic layer created
            400:
              $ref: '#/components/responses/400'
            401:
              $ref: '#/components/responses/401'
            422:
              $ref: '#/components/responses/422'
        """
        try:
            item = SemanticLayerPostSchema().load(request.json)
        except ValidationError as error:
            return self.response_400(message=error.messages)

        try:
            new_model = CreateSemanticLayerCommand(item).run()
            return self.response(201, result={"uuid": str(new_model.uuid)})
        except SemanticLayerInvalidError as ex:
            return self.response_422(message=str(ex))
        except SemanticLayerCreateFailedError as ex:
            logger.error(
                "Error creating semantic layer: %s",
                str(ex),
                exc_info=True,
            )
            return self.response_422(message=str(ex))

    @expose("/<uuid>", methods=("PUT",))
    @protect()
    @safe
    @statsd_metrics
    @requires_json
    def put(self, uuid: str) -> FlaskResponse:
        """Update a semantic layer.
        ---
        put:
          summary: Update a semantic layer
          parameters:
          - in: path
            schema:
              type: string
            name: uuid
          requestBody:
            required: true
            content:
              application/json:
                schema:
                  type: object
                  properties:
                    name:
                      type: string
                    description:
                      type: string
                    configuration:
                      type: object
                    cache_timeout:
                      type: integer
          responses:
            200:
              description: Semantic layer updated
            400:
              $ref: '#/components/responses/400'
            401:
              $ref: '#/components/responses/401'
            404:
              $ref: '#/components/responses/404'
            422:
              $ref: '#/components/responses/422'
        """
        try:
            item = SemanticLayerPutSchema().load(request.json)
        except ValidationError as error:
            return self.response_400(message=error.messages)

        try:
            changed_model = UpdateSemanticLayerCommand(uuid, item).run()
            return self.response(200, result={"uuid": str(changed_model.uuid)})
        except SemanticLayerNotFoundError:
            return self.response_404()
        except SemanticLayerInvalidError as ex:
            return self.response_422(message=str(ex))
        except SemanticLayerUpdateFailedError as ex:
            logger.error(
                "Error updating semantic layer: %s",
                str(ex),
                exc_info=True,
            )
            return self.response_422(message=str(ex))

    @expose("/<uuid>", methods=("DELETE",))
    @protect()
    @safe
    @statsd_metrics
    def delete(self, uuid: str) -> FlaskResponse:
        """Delete a semantic layer.
        ---
        delete:
          summary: Delete a semantic layer
          parameters:
          - in: path
            schema:
              type: string
            name: uuid
          responses:
            200:
              description: Semantic layer deleted
            401:
              $ref: '#/components/responses/401'
            404:
              $ref: '#/components/responses/404'
            422:
              $ref: '#/components/responses/422'
        """
        try:
            DeleteSemanticLayerCommand(uuid).run()
            return self.response(200, message="OK")
        except SemanticLayerNotFoundError:
            return self.response_404()
        except SemanticLayerDeleteFailedError as ex:
            logger.error(
                "Error deleting semantic layer: %s",
                str(ex),
                exc_info=True,
            )
            return self.response_422(message=str(ex))

    @expose("/", methods=("GET",))
    @protect()
    @safe
    @statsd_metrics
    def get_list(self) -> FlaskResponse:
        """List all semantic layers.
        ---
        get:
          summary: List all semantic layers
          responses:
            200:
              description: A list of semantic layers
            401:
              $ref: '#/components/responses/401'
        """
        layers = SemanticLayerDAO.find_all()
        result = [_serialize_layer(layer) for layer in layers]
        return self.response(200, result=result)

    @expose("/<uuid>", methods=("GET",))
    @protect()
    @safe
    @statsd_metrics
    def get(self, uuid: str) -> FlaskResponse:
        """Get a single semantic layer.
        ---
        get:
          summary: Get a semantic layer by UUID
          parameters:
          - in: path
            schema:
              type: string
            name: uuid
          responses:
            200:
              description: A semantic layer
            401:
              $ref: '#/components/responses/401'
            404:
              $ref: '#/components/responses/404'
        """
        layer = SemanticLayerDAO.find_by_uuid(uuid)
        if not layer:
            return self.response_404()
        return self.response(200, result=_serialize_layer(layer))
