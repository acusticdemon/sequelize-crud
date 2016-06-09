"use strict";

var _ = require('lodash');
var Promise = require('bluebird');
var HttpError = require('http-errors');

var models = require('../../models');
var paramsToTree = require('params-to-tree');

const LIMIT = 'limit';
const OFFSET = 'offset';
const ORDER = 'order';
const INCLUDE = 'include';
const ATTRIBUTES = 'attributes';
const EXCLUDE = 'exclude';
const IGNORE = [LIMIT, OFFSET, ORDER, INCLUDE, ATTRIBUTES];

/**
 * @typedef {Object} requestParams
 * @property {number} [offset]
 * @property {number} [limit]
 */

/**
 * Base CRUD resource controller
 */
class Base {
    constructor() {
        this.modelName = this.constructor.name;
        this.model = models[this.modelName];
        this.relations = _.map(this.model.associations, model => model.target.name);

        this.defaultAttributes = null;
        this.defaultExclude = null;
    }

    static get LIMIT() {
        return 100;
    }

    static get OFFSET() {
        return 0;
    }

    /**
     * @param {requestParams} params
     * @return {Promise.<T>}
     */
    find(params) {
        params = paramsToTree(params);

        let options = this._getOptions(params);

        let dataP = this.model
            .findAll(options);

        let totalP = this.model
            .count(_.omit(options, LIMIT, OFFSET));

        return Promise.all([dataP, totalP])
            .spread((data, total) => {
                return {
                    data,
                    meta: {
                        count: data.length,
                        total,
                        limit: options.limit,
                        offset: options.offset
                    }
                };
            });
    }

    /**
     * @param {number} id
     * @param {requestParams} params
     * @return {Promise.<T>}
     * @throws {HttpError} - Not found(404)
     */
    findById(id, params) {
        let options = this._getOptions(params);

        return this.model
            .findById(id, options)
            .then((data) => {
                if (!data) {
                    throw HttpError(404);
                }

                return {data};
            });
    }


    /**
     * If create fails with UniqueConstraintError return found object by query
     * @param data
     * @return {Promise.<T>}
     */
    create(data) {
        return this.model
            .create(data)
            .catch(e => {
                if (!(e instanceof models.Sequelize.UniqueConstraintError)) {
                    throw e;
                }

                return this.model
                    .findOne({where: data})
            })
            .then(data => ({data}));
    }

    /**
     * @param {number} id
     * @param {Object} data
     * @return {Promise.<T>}
     * @throws {HttpError} - Accepted(204) when not updated row
     */
    update(id, data) {
        return this.model
            .update(data, {
                where: {
                    id: id
                }
            })
            .then((affectedRows) => {
                if (!affectedRows) {
                    throw HttpError(204);
                }
            });
    }

    /**
     * @param {Object} condition
     * @return {Promise.<T>}
     * @throws {HttpError} - Accepted(202) when not deleted row
     */
    remove(condition) {
        return this.model
            .destroy({
                where: condition
            })
            .then((affectedRows) => {
                if (!affectedRows) {
                    throw HttpError(202);
                }
            });
    }

    /**
     * @param options
     * @return {{where: *, include: Array<*>, order: *, limit: number, offset: number}}
     * @protected
     */
    _getOptions(options) {
        let include = _.reduce(options, (include, val, name) => {
            if (this.relations.indexOf(name) > -1) {
                _.set(include, name + '.model', models[name]);

                let attributes = _.get(_.pick(val, ATTRIBUTES), ATTRIBUTES);
                if (attributes) {
                    _.set(include, [name, ATTRIBUTES].join('.'), _.isArray(attributes) ? attributes : [attributes]);
                    val = _.omit(val, ATTRIBUTES)
                }

                _.set(include, name + '.where', models.Sequelize.and(val));
            }

            return include;
        }, {});

        let includeModels = options[INCLUDE] || [];
        includeModels = _.isArray(includeModels) ? includeModels : [includeModels];

        includeModels.forEach((name) => _.set(include, name + '.model', models[name]));

        let order = _.reduce(options.order, (order, value, name) => {
            if (this.relations.indexOf(name) > -1) {
                let orderModel = models[name];
                _.set(include, name + '.model', orderModel);
                order.concat(_.map(value, (val, field) => [orderModel, field, val]));
            } else {
                order.push([name, value]);
            }

            return order;
        }, []);

        let where = _.omit(options, _.keys(include), IGNORE);

        let limit = +_.get(options, LIMIT, this.constructor.LIMIT);
        let offset = +_.get(options, OFFSET, this.constructor.OFFSET);

        let attributes = options.attributes || this.defaultAttributes || Object.keys(this.model.attributes);
        attributes = _.isArray(attributes) ? attributes : [attributes];

        attributes = _.difference(attributes, options.exclude, this.defaultExclude);

        return {
            attributes,
            where,
            include: _.values(include),
            order,
            limit,
            offset,
            subQuery: false
        };
    }
}

module.exports = Base;
