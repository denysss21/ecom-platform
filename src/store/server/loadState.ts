import { RouterContext } from "@koa/router"
import { readFile } from "fs-extra"
import {
  getParsedProductFilter,
  getProductFilterForCategory,
  getProductFilterForSearch,
} from "../shared/actions"
import { PAGE, PRODUCT, PRODUCT_CATEGORY, SEARCH } from "../shared/pageTypes"
import api from "./api"

const PRODUCT_FIELDS =
  "path,id,name,category_id,category_ids,category_name,sku,images,enabled,discontinued,stock_status,stock_quantity,price,on_sale,regular_price,attributes,tags,position"
const CATEGORIES_FIELDS =
  "image,name,description,meta_description,meta_title,sort,parent_id,position,slug,id"

const getCurrentPage = path => {
  return api.sitemap
    .retrieve({ path: path, enabled: true })
    .then(sitemapResponse => {
      if (sitemapResponse.status === 200) {
        return sitemapResponse.json
      } else if (sitemapResponse.status === 404) {
        return {
          type: 404,
          path: path,
          resource: null,
        }
      } else {
        return Promise.reject(`Page response code = ${sitemapResponse.status}`)
      }
    })
}

const getProducts = (currentPage, productFilter) => {
  if (currentPage.type === PRODUCT_CATEGORY || currentPage.type === SEARCH) {
    let filter = getParsedProductFilter(productFilter)
    filter.enabled = true
    return api.products.list(filter).then(({ status, json }) => json)
  } else {
    return null
  }
}

const getProduct = currentPage => {
  if (currentPage.type === PRODUCT) {
    return api.products
      .retrieve(currentPage.resource)
      .then(({ status, json }) => json)
  } else {
    return {}
  }
}

const getPage = currentPage => {
  if (currentPage.type === PAGE) {
    return api.pages
      .retrieve(currentPage.resource)
      .then(({ status, json }) => json)
  } else {
    return {}
  }
}

const getThemeSettings = () => {
  return api.theme.settings
    .retrieve()
    .then(({ status, json }) => json)
    .catch(error => ({}))
}

const getAllData = (currentPage, productFilter, cookie) => {
  return Promise.all([
    api.checkoutFields.list().then(({ status, json }) => json),
    api.productCategories
      .list({ enabled: true, fields: CATEGORIES_FIELDS })
      .then(({ status, json }) => json),
    api.ajax.cart.retrieve(cookie).then(({ status, json }) => json),
    getProducts(currentPage, productFilter),
    getProduct(currentPage),
    getPage(currentPage),
    getThemeSettings(),
  ]).then(
    ([
      checkoutFields,
      categories,
      cart,
      products,
      product,
      page,
      themeSettings,
    ]) => {
      let categoryDetails = null
      if (currentPage.type === PRODUCT_CATEGORY) {
        categoryDetails = categories.find(c => c.id === currentPage.resource)
      }
      return {
        checkoutFields,
        categories,
        cart,
        products,
        product,
        page,
        categoryDetails,
        themeSettings,
      }
    }
  )
}

const getState = (currentPage, settings, allData, location, productFilter) => {
  const {
    checkoutFields,
    categories,
    cart,
    products,
    product,
    page,
    categoryDetails,
    themeSettings,
  } = allData

  let productsTotalCount = 0
  let productsHasMore = false
  let productsMinPrice = 0
  let productsMaxPrice = 0
  let productsAttributes = []

  if (products) {
    productsTotalCount = products.total_count
    productsHasMore = products.has_more
    productsAttributes = products.attributes

    if (products.price) {
      productsMinPrice = products.price.min
      productsMaxPrice = products.price.max
    }
  }

  const state = {
    app: {
      settings: settings,
      location: location,
      currentPage: currentPage,
      pageDetails: page,
      categoryDetails: categoryDetails,
      productDetails: product,
      categories: categories,
      products: products && products.data ? products.data : [],
      productsTotalCount: productsTotalCount,
      productsHasMore: productsHasMore,
      productsMinPrice: productsMinPrice,
      productsMaxPrice: productsMaxPrice,
      productsAttributes: productsAttributes,
      paymentMethods: [],
      shippingMethods: [],
      loadingProducts: false,
      loadingMoreProducts: false,
      loadingShippingMethods: false,
      loadingPaymentMethods: false,
      processingCheckout: false,
      productFilter: {
        onSale: null,
        search: productFilter.search || "",
        categoryId: productFilter.categoryId,
        priceFrom: productFilter.priceFrom || 0,
        priceTo: productFilter.priceTo || 0,
        attributes: productFilter.attributes,
        sort: settings.default_product_sorting,
        fields:
          settings.product_fields && settings.product_fields !== ""
            ? settings.product_fields
            : PRODUCT_FIELDS,
        limit:
          settings.products_limit && settings.products_limit !== 0
            ? settings.products_limit
            : 30,
      },
      cart: cart,
      order: null,
      checkoutFields: checkoutFields,
      themeSettings: themeSettings,
    },
  }

  return state
}

const getFilter = (currentPage, urlQuery, settings) => {
  let productFilter = {} as any

  if (currentPage.type === PRODUCT_CATEGORY) {
    productFilter = getProductFilterForCategory(
      urlQuery,
      settings.default_product_sorting
    )
    productFilter.categoryId = currentPage.resource
  } else if (currentPage.type === SEARCH) {
    productFilter = getProductFilterForSearch(urlQuery)
  }

  productFilter.fields =
    settings.product_fields && settings.product_fields !== ""
      ? settings.product_fields
      : PRODUCT_FIELDS
  productFilter.limit =
    settings.products_limit && settings.products_limit !== 0
      ? settings.products_limit
      : 30

  return productFilter
}

export const loadState = async (ctx: RouterContext, language) => {
  const cookie = ctx.get("cookie")
  const urlPath = ctx.path
  const urlQuery = ctx.url.includes("?")
    ? ctx.url.substring(ctx.url.indexOf("?"))
    : ""
  const location = {
    hasHistory: false,
    pathname: urlPath,
    search: urlQuery,
    hash: "",
  }

  const getText = async (locale: string) => {
    const filePath = `${process.env.THEME_DIR}/assets/locales/${locale}.json`
    const file = await readFile(filePath, "utf8")
    return JSON.parse(file)
  }

  const currentPage = await getCurrentPage(ctx.path)
  const { json } = await api.settings.retrieve()
  const themeText = await getText(language)
  const placeholdersResponse = await api.theme.placeholders.list()

  const productFilter = getFilter(currentPage, urlQuery, json)
  const allData = await getAllData(currentPage, productFilter, cookie)
  const state = getState(currentPage, json, allData, location, productFilter)

  return {
    state,
    themeText,
    placeholders: placeholdersResponse.json,
  }
}
